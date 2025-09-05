import asyncio
import websockets
import json

async def test_websocket():
    uri = "ws://localhost:8092/api/v1/logs/ws/logs/d2b40bd7e989"
    try:
        async with websockets.connect(uri) as websocket:
            print("Connected to WebSocket server")
            
            # Send a ping message
            await websocket.send(json.dumps({"type": "ping"}))
            print("Sent ping")
            
            # Wait for a response
            response = await websocket.recv()
            print(f"Received: {response}")
            
            # Keep the connection open and print any incoming messages
            while True:
                try:
                    message = await asyncio.wait_for(websocket.recv(), timeout=5.0)
                    print(f"Received: {message}")
                except asyncio.TimeoutError:
                    print("No messages received for 5 seconds. Sending ping...")
                    await websocket.send(json.dumps({"type": "ping"}))
                    
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.get_event_loop().run_until_complete(test_websocket())
