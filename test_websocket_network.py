#!/usr/bin/env python3
"""
Test WebSocket connection from network URL to diagnose disconnection issues.
"""
import asyncio
import websockets
import json
import sys
from datetime import datetime

async def test_websocket_connection(host, port, container_id, duration=60):
    """Test WebSocket connection and keep it alive for specified duration."""
    ws_url = f"ws://{host}:{port}/ws/logs/{container_id}"
    
    print(f"Testing WebSocket connection to: {ws_url}")
    print(f"Will maintain connection for {duration} seconds...")
    print("-" * 60)
    
    try:
        async with websockets.connect(
            ws_url,
            ping_interval=None,  # Disable built-in ping
            ping_timeout=None,
            close_timeout=10
        ) as websocket:
            print(f"✓ Connected successfully at {datetime.now().isoformat()}")
            
            start_time = asyncio.get_event_loop().time()
            message_count = 0
            ping_count = 0
            pong_count = 0
            
            async def receive_messages():
                nonlocal message_count, ping_count, pong_count
                try:
                    async for message in websocket:
                        try:
                            data = json.loads(message)
                            msg_type = data.get('type', 'unknown')
                            
                            if msg_type == 'connection_established':
                                print(f"✓ Connection established: {data}")
                            elif msg_type == 'ping':
                                ping_count += 1
                                # Respond to server ping
                                await websocket.send(json.dumps({
                                    'type': 'pong',
                                    'timestamp': datetime.now().isoformat()
                                }))
                                print(f"← Received ping #{ping_count}, sent pong")
                            elif msg_type == 'pong':
                                pong_count += 1
                                print(f"← Received pong #{pong_count}")
                            elif msg_type == 'log':
                                message_count += 1
                                log_msg = data.get('payload', {}).get('message', '')[:50]
                                print(f"← Log #{message_count}: {log_msg}...")
                            else:
                                print(f"← Received {msg_type}: {data}")
                        except json.JSONDecodeError:
                            print(f"← Received non-JSON message: {message[:100]}")
                except websockets.exceptions.ConnectionClosed as e:
                    print(f"✗ Connection closed: code={e.code}, reason={e.reason}")
                except Exception as e:
                    print(f"✗ Error receiving messages: {e}")
            
            # Start receiving messages in background
            receive_task = asyncio.create_task(receive_messages())
            
            # Keep connection alive for specified duration
            try:
                elapsed = 0
                while elapsed < duration:
                    await asyncio.sleep(10)
                    elapsed = asyncio.get_event_loop().time() - start_time
                    print(f"⏱ Connection alive for {int(elapsed)}s (messages: {message_count}, pings: {ping_count}, pongs: {pong_count})")
                    
                    # Check if receive task is still running
                    if receive_task.done():
                        print("✗ Receive task ended unexpectedly")
                        break
                
                print(f"\n✓ Test completed successfully!")
                print(f"  Duration: {int(elapsed)}s")
                print(f"  Messages received: {message_count}")
                print(f"  Pings received: {ping_count}")
                print(f"  Pongs received: {pong_count}")
                
            except KeyboardInterrupt:
                print("\n⚠ Test interrupted by user")
            finally:
                receive_task.cancel()
                try:
                    await receive_task
                except asyncio.CancelledError:
                    pass
                    
    except websockets.exceptions.InvalidStatusCode as e:
        print(f"✗ Connection failed with status code: {e.status_code}")
        return False
    except websockets.exceptions.WebSocketException as e:
        print(f"✗ WebSocket error: {e}")
        return False
    except Exception as e:
        print(f"✗ Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        return False
    
    return True

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python test_websocket_network.py <host> <container_id> [duration_seconds]")
        print("Example: python test_websocket_network.py 192.168.0.109 erp-suite-api-gateway 60")
        sys.exit(1)
    
    host = sys.argv[1]
    container_id = sys.argv[2]
    duration = int(sys.argv[3]) if len(sys.argv) > 3 else 60
    port = 8093  # Default WebSocket port
    
    success = asyncio.run(test_websocket_connection(host, port, container_id, duration))
    sys.exit(0 if success else 1)
