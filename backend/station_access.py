"""Prototype station access and on-demand RailRadar board; never commands trains."""
import hmac
import hashlib
import json
import os
import re
import secrets
import sqlite3
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from urllib.parse import quote

from fastapi import APIRouter, Header, HTTPException, Request as FastAPIRequest
from pydantic import BaseModel, Field
from timetable_catalog import normalize_route
from timetable_preview import preview as timetable_preview, RUNNING_MODEL_FINGERPRINT
from datetime import date
from typing import Literal

router = APIRouter(prefix="/station-access", tags=["station access"])
_sessions = {}
_attempts = {}
_cache = {}
_lock = threading.Lock()

class PinRequest(BaseModel):
    pin: str = Field(min_length=4, max_length=12, pattern=r"^[0-9]+$")

def require_session(authorization: str | None):
    token = authorization.removeprefix("Bearer ") if authorization else ""
    with _lock:
        expires = _sessions.get(token, 0)
        if expires <= time.time():
            _sessions.pop(token, None)
            raise HTTPException(401, "Station session expired. Enter the PIN again.")

@router.post('/login')
def login(payload: PinRequest, request: FastAPIRequest):
    configured = os.getenv('STATION_MASTER_PIN', '')
    if not re.fullmatch(r'\d{4,12}', configured):
        raise HTTPException(503, 'Set STATION_MASTER_PIN on the backend before using station access.')
    ip = request.client.host if request.client else 'unknown'
    now = time.time()
    with _lock:
        attempts = [t for t in _attempts.get(ip, []) if now - t < 300]
        if len(attempts) >= 5:
            raise HTTPException(429, 'Too many attempts. Try again in five minutes.')
        if not hmac.compare_digest(payload.pin, configured):
            attempts.append(now)
            _attempts[ip] = attempts
            raise HTTPException(401, 'Incorrect PIN.')
        _attempts.pop(ip, None)
        token = secrets.token_urlsafe(32)
        _sessions[token] = now + 3600
    return {'token': token, 'station': 'SC', 'expires_in': 3600}

@router.post('/logout')
def logout(authorization: str | None = Header(default=None)):
    token = authorization.removeprefix('Bearer ') if authorization else ''
    with _lock:
        _sessions.pop(token, None)
    return {'status': 'logged out'}

@router.get('/board/{station}')
def board(station: str, authorization: str | None = Header(default=None)):
    require_session(authorization)
    station = station.upper()
    if station not in {'SC', 'MED', 'MOB', 'WDR'}:
        raise HTTPException(403, 'This station is not enabled for the reference board.')
    key = os.getenv('RAILRADAR_API_KEY', '').strip()
    if not key:
        raise HTTPException(503, 'RailRadar API key is not configured on the backend.')
    now = time.time()
    # Serialize requests so concurrent refreshes do not spend duplicate quota.
    with _lock:
        cached = _cache.get(f'board:{station}')
        if cached and now - cached['fetched_at'] < 900:
            return {**cached, 'cached': True}
        req = Request(f'https://api.railradar.in/v1/stations/{station}/live?hours=2&includeIntermediate=true', headers={'Authorization': f'Bearer {key}', 'Accept': 'application/json'})
        try:
            with urlopen(req, timeout=12) as response:
                body = json.load(response)
            if not body.get('success') or not isinstance(body.get('data', {}).get('trains'), list):
                raise ValueError('Unexpected response')
            returned_code = body['data'].get('station', {}).get('code')
            if returned_code and str(returned_code).upper() != station:
                raise ValueError('Station does not match the requested board')
        except (HTTPError, URLError, TimeoutError, ValueError, json.JSONDecodeError) as exc:
            if cached:
                return {**cached, 'cached': True, 'stale': True}
            status = exc.code if isinstance(exc, HTTPError) else 503
            raise HTTPException(status if status in (401, 403, 429) else 502, 'RailRadar unavailable or rejected the request. Check your key and quota.') from None
        result = {'source': 'RailRadar', 'station': station, 'fetched_at': time.time(), 'cached': False, 'stale': False, 'data': body['data'], 'provider_timestamp': body.get('meta', {}).get('timestamp')}
        _cache[f'board:{station}'] = result
        try:
            save_snapshot(result)
            result['recorded'] = True
        except (OSError, sqlite3.Error):
            result['recorded'] = False
        return result


# Snapshot storage is a local demo record, not an operational data store.
def snapshot_connection():
    path = os.getenv('RAILFLOW_SNAPSHOT_DB', os.path.join(os.path.dirname(__file__), 'data', 'station_snapshots.sqlite3'))
    connection = sqlite3.connect(path)
    connection.execute('CREATE TABLE IF NOT EXISTS snapshots (id INTEGER PRIMARY KEY, fetched_at REAL NOT NULL, payload TEXT NOT NULL)')
    connection.execute('CREATE TABLE IF NOT EXISTS timetables (train_number TEXT PRIMARY KEY, fetched_at REAL NOT NULL, provider_timestamp TEXT, payload TEXT NOT NULL)')
    connection.execute('CREATE TABLE IF NOT EXISTS timetable_previews (id INTEGER PRIMARY KEY, created_at REAL NOT NULL, payload TEXT NOT NULL)')
    connection.execute('CREATE TABLE IF NOT EXISTS simulation_incidents (id TEXT PRIMARY KEY, payload TEXT NOT NULL)')
    connection.execute('CREATE TABLE IF NOT EXISTS simulation_incident_events (id INTEGER PRIMARY KEY, incident_id TEXT NOT NULL, event TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL)')
    connection.execute('CREATE TABLE IF NOT EXISTS replay_review_events (id INTEGER PRIMARY KEY, preview_id INTEGER NOT NULL, decision_index INTEGER NOT NULL, event TEXT NOT NULL, created_at TEXT NOT NULL)')
    connection.execute('CREATE TABLE IF NOT EXISTS replay_reviews (preview_id INTEGER NOT NULL, decision_index INTEGER NOT NULL, status TEXT NOT NULL, alternative TEXT, instruction_id TEXT, PRIMARY KEY (preview_id, decision_index))')
    connection.execute('CREATE TABLE IF NOT EXISTS simulation_instructions (id TEXT PRIMARY KEY, station TEXT NOT NULL, train_id TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL, plan_revision INTEGER NOT NULL, acknowledged_at TEXT)')
    return connection

def save_snapshot(result):
    with snapshot_connection() as db:
        db.execute('INSERT INTO snapshots (fetched_at, payload) VALUES (?, ?)', (result['fetched_at'], json.dumps(result)))

@router.get('/snapshots')
def snapshots(authorization: str | None = Header(default=None)):
    require_session(authorization)
    with snapshot_connection() as db:
        rows = db.execute('SELECT id, fetched_at, payload FROM snapshots ORDER BY id DESC LIMIT 50').fetchall()
    return [{'id': row[0], 'fetched_at': row[1], 'station': json.loads(row[2]).get('station', 'SC')} for row in rows]

@router.get('/snapshots/{snapshot_id}')
def snapshot(snapshot_id: int, authorization: str | None = Header(default=None)):
    require_session(authorization)
    with snapshot_connection() as db:
        row = db.execute('SELECT payload FROM snapshots WHERE id = ?', (snapshot_id,)).fetchone()
    if not row:
        raise HTTPException(404, 'Snapshot not found.')
    return {**json.loads(row[0]), 'replay': True}

def train_data(number, kind):
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,20}', number):
        raise HTTPException(400, 'Invalid train number.')
    key = os.getenv('RAILRADAR_API_KEY', '').strip()
    if not key:
        raise HTTPException(503, 'RailRadar API key is not configured on the backend.')
    cache_key = f'{kind}:{number}'
    ttl = 86400 if kind == 'route' else 900
    with _lock:
        cached = _cache.get(cache_key)
        if cached and time.time() - cached['fetched_at'] < ttl:
            return {**cached, 'cached': True}
        suffix = '' if kind == 'route' else '/live'
        req = Request(f'https://api.railradar.in/v1/trains/{quote(number, safe="")}{suffix}', headers={'Authorization': f'Bearer {key}', 'Accept': 'application/json'})
        try:
            with urlopen(req, timeout=12) as response:
                body = json.load(response)
            if not body.get('success') or not isinstance(body.get('data'), dict):
                raise ValueError('Unexpected response')
            if kind == 'route' and not isinstance(body['data'].get('route'), list):
                raise ValueError('Missing route')
        except (HTTPError, URLError, TimeoutError, ValueError, json.JSONDecodeError) as exc:
            if cached:
                return {**cached, 'cached': True, 'stale': True}
            status = exc.code if isinstance(exc, HTTPError) else 503
            raise HTTPException(status if status in (401, 403, 404, 429) else 502, 'RailRadar unavailable or rejected the request. Check the train number, key and quota.') from None
        result = {'source': 'RailRadar', 'fetched_at': time.time(), 'provider_timestamp': body.get('meta', {}).get('timestamp'), 'data': body['data'], 'cached': False, 'stale': False}
        if kind == 'route':
            try:
                normalized = normalize_route(body['data'])
                if normalized['train']['number'].upper() != number.upper():
                    raise ValueError('Provider returned a different train number.')
                with snapshot_connection() as db:
                    db.execute('INSERT OR REPLACE INTO timetables (train_number, fetched_at, provider_timestamp, payload) VALUES (?, ?, ?, ?)', (number, result['fetched_at'], result['provider_timestamp'], json.dumps(normalized)))
                result['catalog'] = {'recorded': True, **normalized}
            except (ValueError, OSError, sqlite3.Error):
                result['catalog'] = {'recorded': False, 'warnings': ['This route could not be normalized or saved.'], 'solver_ready': False}
        _cache[cache_key] = result
        return result

@router.get('/timetables')
def timetables(authorization: str | None = Header(default=None)):
    require_session(authorization)
    with snapshot_connection() as db:
        rows = db.execute('SELECT train_number, fetched_at, provider_timestamp, payload FROM timetables ORDER BY fetched_at DESC').fetchall()
    return [{'train_number': number, 'fetched_at': fetched, 'provider_timestamp': timestamp, **json.loads(payload)} for number, fetched, timestamp, payload in rows]

@router.get('/train/{number}/{kind}')
def train_lookup(number: str, kind: str, authorization: str | None = Header(default=None)):
    require_session(authorization)
    if kind not in ('route', 'live'):
        raise HTTPException(404, 'Unknown lookup.')
    return train_data(number, kind)


@router.get('/between/{origin}/{destination}')
def trains_between(origin: str, destination: str, authorization: str | None = Header(default=None)):
    require_session(authorization)
    origin, destination = origin.upper(), destination.upper()
    allowed = {'SC', 'KCG', 'MJF', 'BMO', 'MED', 'MOB', 'ME', 'WDR'}
    if origin not in allowed or destination not in allowed or origin == destination:
        raise HTTPException(400, 'Choose two different corridor stations.')
    key = os.getenv('RAILRADAR_API_KEY', '').strip()
    if not key:
        raise HTTPException(503, 'RailRadar API key is not configured on the backend.')
    cache_key = f'between:{origin}:{destination}'
    with _lock:
        cached = _cache.get(cache_key)
        if cached and time.time() - cached['fetched_at'] < 86400:
            return {**cached, 'cached': True}
        req = Request(f'https://api.railradar.in/v1/trains/between/{origin}/{destination}', headers={'Authorization': f'Bearer {key}', 'Accept': 'application/json'})
        try:
            with urlopen(req, timeout=12) as response:
                body = json.load(response)
            if not body.get('success') or not isinstance(body.get('data', {}).get('trains'), list):
                raise ValueError('Unexpected response')
        except (HTTPError, URLError, TimeoutError, ValueError, json.JSONDecodeError) as exc:
            if cached:
                return {**cached, 'cached': True, 'stale': True}
            status = exc.code if isinstance(exc, HTTPError) else 503
            raise HTTPException(status if status in (401, 403, 404, 429) else 502, 'RailRadar unavailable or rejected the request. Check the key and quota.') from None
        result = {'source': 'RailRadar', 'fetched_at': time.time(), 'provider_timestamp': body.get('meta', {}).get('timestamp'), 'data': body['data'], 'cached': False, 'stale': False}
        _cache[cache_key] = result
        return result


class SyntheticScenario(BaseModel):
    type: Literal['loco_failure', 'closed_block']
    block_id: str = Field(min_length=1, max_length=20, pattern=r'^[A-Z_]+$')
    train_id: str | None = None
    duration_minutes: int = Field(ge=1, le=120)
    start_minute: int = Field(default=0, ge=0, le=1799)

class PreviewRequest(BaseModel):
    corridor_date: date
    train_numbers: list[str] = Field(min_length=1, max_length=20)
    delay_train: str | None = None
    delay_minutes: int = Field(default=0, ge=0, le=120)
    scenario: SyntheticScenario | None = None

@router.post('/timetable-preview')
def create_timetable_preview(payload: PreviewRequest, authorization: str | None = Header(default=None)):
    require_session(authorization)
    numbers = payload.train_numbers
    if len(set(numbers)) != len(numbers) or any(not re.fullmatch(r'[A-Za-z0-9_-]{1,20}', n) for n in numbers):
        raise HTTPException(422, 'Select unique valid train numbers.')
    records = []
    with snapshot_connection() as db:
        for number in numbers:
            row = db.execute('SELECT fetched_at, provider_timestamp, payload FROM timetables WHERE train_number = ?', (number,)).fetchone()
            if row is None:
                raise HTTPException(422, f'Saved route {number} was not found. Check the route first.')
            records.append({'fetched_at': row[0], 'provider_timestamp': row[1], 'record': json.loads(row[2])})
    if payload.delay_minutes and payload.delay_train not in numbers:
        raise HTTPException(422, 'Choose a selected train for the synthetic delay.')
    if payload.scenario and payload.delay_minutes:
        raise HTTPException(422, 'Choose one synthetic scenario at a time.')
    if payload.scenario and payload.scenario.type == 'loco_failure' and payload.scenario.train_id not in numbers:
        raise HTTPException(422, 'Choose a selected train for the locomotive failure.')
    scenario = payload.scenario.model_dump() if payload.scenario else None
    inputs = {'corridor_date': payload.corridor_date.isoformat(), 'timetables': records, 'delay_train': payload.delay_train if payload.delay_minutes else None, 'delay_minutes': payload.delay_minutes, 'scenario': scenario}
    digest = hashlib.sha256(json.dumps(inputs, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    try:
        result = timetable_preview([row['record'] for row in records], payload.corridor_date, payload.delay_train, payload.delay_minutes, scenario)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    data = {'mode': 'TIMETABLE_SIMULATION', 'model_fingerprint': RUNNING_MODEL_FINGERPRINT, 'created_at': time.time(), 'input_fingerprint': digest, 'input': inputs, 'result': result, 'limitations': 'Saved provider schedules with assumed infrastructure and synthetic train priorities. No live positions or real occupancy. Preview only; not an operational instruction.'}
    with snapshot_connection() as db:
        cur = db.execute('INSERT INTO timetable_previews (created_at, payload) VALUES (?, ?)', (data['created_at'], json.dumps(data)))
        preview_id = cur.lastrowid
    return {'id': preview_id, **data}

@router.get('/timetable-previews')
def timetable_previews(authorization: str | None = Header(default=None)):
    require_session(authorization)
    with snapshot_connection() as db:
        rows = db.execute('SELECT id, created_at FROM timetable_previews ORDER BY id DESC LIMIT 50').fetchall()
    return [{'id': row[0], 'created_at': row[1]} for row in rows]

@router.get('/timetable-previews/{preview_id}')
def timetable_preview_replay(preview_id: int, authorization: str | None = Header(default=None)):
    require_session(authorization)
    with snapshot_connection() as db:
        row = db.execute('SELECT payload FROM timetable_previews WHERE id = ?', (preview_id,)).fetchone()
    if row is None:
        raise HTTPException(404, 'Preview not found.')
    return {'id': preview_id, 'replay': True, **json.loads(row[0])}


@router.get('/instructions')
def station_instructions(authorization: str | None = Header(default=None)):
    require_session(authorization)
    with snapshot_connection() as db:
        rows = db.execute('SELECT id, station, train_id, message, created_at, plan_revision, acknowledged_at FROM simulation_instructions WHERE station = ? ORDER BY created_at DESC LIMIT 50', ('SC',)).fetchall()
    keys = ('id', 'station', 'train_id', 'message', 'created_at', 'plan_revision', 'acknowledged_at')
    return [dict(zip(keys, row)) for row in rows]

@router.post('/instructions/{instruction_id}/acknowledge')
def acknowledge_instruction(instruction_id: str, authorization: str | None = Header(default=None)):
    require_session(authorization)
    from datetime import datetime, timezone
    with snapshot_connection() as db:
        row = db.execute('SELECT station, acknowledged_at FROM simulation_instructions WHERE id = ?', (instruction_id,)).fetchone()
        if row is None:
            raise HTTPException(404, 'Instruction not found.')
        if row[0] != 'SC':
            raise HTTPException(403, 'Instruction is for a different station.')
        acknowledged_at = row[1] or datetime.now(timezone.utc).isoformat()
        db.execute('UPDATE simulation_instructions SET acknowledged_at = ? WHERE id = ? AND station = ?', (acknowledged_at, instruction_id, 'SC'))
    return {'status': 'acknowledged', 'acknowledged_at': acknowledged_at}
