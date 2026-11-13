import { createContext, useContext } from 'react';

export const StationToken = createContext('');
export const useStationToken = () => useContext(StationToken);
