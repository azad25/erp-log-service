export interface LogEntry {
    timestamp: string;
    message: string;
    level?: string;
    container_id: string;
    container_name?: string;
    service?: string;
    source?: string;
    stream?: 'stdout' | 'stderr';
}

export interface ContainerInfo {
    id: string;
    name: string;
    state: string;
    status: string;
}

export interface ContainerStats {
    id: string;
    name: string;
    cpu_usage: number;
    memory_usage: number;
    memory_limit: number;
    network_rx: number;
    network_tx: number;
    timestamp: string;
}
