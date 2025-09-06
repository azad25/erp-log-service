import axios from 'axios';
import { ContainerInfo } from '../types/containers';

const API_BASE_URL = '/api/v1/logs';

export const getContainers = async (): Promise<ContainerInfo[]> => {
  const response = await axios.get(`${API_BASE_URL}/containers`);
  return response.data;
};

export const getContainer = async (id: string): Promise<ContainerInfo> => {
  const response = await axios.get(`${API_BASE_URL}/containers/${id}`);
  return response.data;
};

export const getContainerLogs = async (id: string, tail: number = 100): Promise<string[]> => {
  const response = await axios.get(`${API_BASE_URL}/logs/${id}`, {
    params: { limit: tail }
  });
  return response.data;
};

export const startContainer = async (id: string): Promise<void> => {
  await axios.post(`${API_BASE_URL}/containers/${id}/start`);
};

export const stopContainer = async (id: string): Promise<void> => {
  await axios.post(`${API_BASE_URL}/containers/${id}/stop`);
};

export const restartContainer = async (id: string): Promise<void> => {
  await axios.post(`${API_BASE_URL}/containers/${id}/restart`);
};

export const getContainerStats = async (id: string): Promise<any> => {
  const response = await axios.get(`${API_BASE_URL}/logs/containers/${id}/stats`);
  return response.data;
};
