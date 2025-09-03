import { ContainerInfo, LogEntry } from '../types/logs';

const API_BASE_URL = '/api/v1';

/**
 * Fetches the list of running Docker containers
 */
export const getContainers = async (): Promise<ContainerInfo[]> => {
  try {
    const response = await fetch(`${API_BASE_URL}/logs/containers`);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error fetching containers:', error);
    throw error;
  }
};

/**
 * Fetches recent logs for a specific container
 * @param containerId The ID of the container to fetch logs for
 * @param limit Maximum number of log entries to return
 */
export const getLogs = async (containerId: string, limit: number = 100): Promise<LogEntry[]> => {
  try {
    const response = await fetch(
      `${API_BASE_URL}/logs/logs/${containerId}?limit=${limit}`
    );
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error(`Error fetching logs for container ${containerId}:`, error);
    throw error;
  }
};

/**
 * Formats a log level to be displayed in the UI
 * @param level The log level to format
 */
export const formatLogLevel = (level: string): string => {
  if (!level) return 'UNKNOWN';
  
  const levelMap: Record<string, string> = {
    'error': 'ERROR',
    'err': 'ERROR',
    'warn': 'WARN',
    'warning': 'WARN',
    'info': 'INFO',
    'debug': 'DEBUG',
    'trace': 'TRACE',
    'fatal': 'FATAL',
    'critical': 'CRITICAL',
  };
  
  const normalizedLevel = level.toLowerCase().trim();
  return levelMap[normalizedLevel] || level.toUpperCase();
};

/**
 * Gets a color for a log level
 * @param level The log level
 */
export const getLogLevelColor = (level: string): string => {
  const levelMap: Record<string, string> = {
    'error': '#f44336',
    'err': '#f44336',
    'warn': '#ff9800',
    'warning': '#ff9800',
    'info': '#2196f3',
    'debug': '#9e9e9e',
    'trace': '#9e9e9e',
    'fatal': '#d81b60',
    'critical': '#d81b60',
  };
  
  return levelMap[level.toLowerCase()] || '#9e9e9e';
};

/**
 * Formats a timestamp for display
 * @param timestamp The timestamp to format
 */
export const formatTimestamp = (timestamp: string): string => {
  if (!timestamp) return '';
  
  try {
    const date = new Date(timestamp);
    return date.toLocaleString();
  } catch (error) {
    return timestamp;
  }
};
