#!/bin/sh
docker run --shm-size=4096m -e KEEP_ALIVE=true -e MAX_CONCURRENT_SESSIONS=10 -e MAX_QUEUE_LENGTH=100 -e CONNECTION_TIMEOUT=180000 -e PREBOOT_CHROME=true -p 3000:3000 --restart always -d --name bc browserless/chrome
