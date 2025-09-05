import asyncio
import websockets
import json

async def test_websocket():
    uri = "ws://localhost:8093/ws/logs/all"
    print(f"Connecting to {uri}...")
    
    try:
        async with websockets.connect(uri) as websocket:
            print("Connected! Waiting for messages...")
            
            # Send a test message
            await websocket.send(json.dumps({"type": "test", "message": "Hello from test client"}))
            
            # Listen for messages
            while True:
                try:
                    message = await asyncio.wait_for(websocket.recv(), timeout=5.0)
                    print(f"Received: {message}")
                except asyncio.TimeoutError:
                    print("No message received in 5 seconds, sending ping...")
                    await websocket.ping()
                    
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.get_event_loop().run_until_complete(test_websocket())
