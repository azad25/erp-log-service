create a simple python script with a react js with bootsrap framework,css3 animation design theme, use websocket for real time log updates, use a queue to process new logs to make it efficient
make the view compononent based to better manage it
i want to create a nice ui for viewing docker logs
for this current erp suit docker containers

there are currently 17 containers 
services, tools,dbs,msgs,queues,cache,proxy

so i want to create just a single page, for view formatted docker logs in a nice list format with highlighted time, analyse logs to the the format of logs and then convert in to a nice view ui format

every time new log refreshes and comes, this page should auto update the list with animated slide in, slide out format

first 10 logs must show

there are errors, msgs different kind of logs

so the python processor must format each logs, extract and convert to view object, and show the data

use @erp-log-service for this application
remove existing go files and make this log service with the frontend inside @erp-log-service folder
it must open the page in localhost:8098 

plan your tasks and then make this servicecreate a simple python script with a react js with bootsrap framework,css3 animation design theme
make the view compononent based to better manage it
i want to create a nice ui for viewing docker logs
for this current erp suit docker containers

there are currently 17 containers 
services, tools,dbs,msgs,queues,cache,proxy

so i want to create just a single page, for view formatted docker logs in a nice list format with highlighted time, analyse logs to the the format of logs and then convert in to a nice view ui format

every time new log refreshes and comes, this page should auto update the list with animated slide in, slide out format

first 10 logs must show

there are errors, msgs different kind of logs

so the python processor must format each logs, extract and convert to view object, and show the data

use @erp-log-service for this application
remove existing go files and make this log service with the frontend inside @erp-log-service folder


read these codes and plans
and make the docker log service
inside ./erp-suite/erp-log-service
use python fast api
Set up the project structure
Create a Python FastAPI backend to fetch and process Docker logs
Build a React frontend with Bootstrap and animations
Implement WebSocket for real-time updates
Create log parsing and formatting logic
Style the UI with CSS animations

use 8092 port for this service
and make sure 
the page displays all the application services first
the page will display each container logs  like the above design within the viewport height
then the infra services
make sure to add a way to see previous logs of each container
add tooltip when hovered over container to show container info
make sure to add a green fot circle for running containers and red circle dot for stopped/not running
orange dot icon for when starting
add start,stop,restart respective buttons for each container
use just icons for buttons, no title needed
also add a icon beside each containers button to view all the related container logs in a modal, when clicked, a modal will full screen open and show all the logs of the selected container, and button for closing the modal
the log list items in modal should have a background light green or light red based on success log or error logs
new logs must slide in, old log slide out
