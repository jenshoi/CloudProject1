Assignment 1 - REST API Project - Response to Criteria
================================================

Overview
------------------------------------------------

- **Name:** Jens Hoeie
- **Student number:** n12541249
- **Application name:** CarCounter
- **Two line description:** This REST API lets authenticated users upload video files, runs a YOLO-based car counting algorithm, and returns counts, processed videos and snapshots. Metadata is stored in a MariaDB database.
- **AI clarification:** i want to say that in general alt code is from me, but i have used chatGPT to fix some of the syntax error etc. Some parts of the code is chatGPT only, in that case i have made a comment
Core criteria
------------------------------------------------

### Containerise the app

- **ECR Repository name:** n12541249-car-counter
- **Video timestamp:** 00:00 - 00:54
- **Relevant files:**
    - /Dockerfile
    - /docker-compose.yml
    - /.dockerignore

### Deploy the container

- **EC2 instance ID:** i-07ce9ff2408bb1341
- **Video timestamp:** 00:00 - 00:54

### User login

- **One line description:** Hard-coded users stored in-memory. JWT tokens used for session authentication and role-based access (user/admin).
- **Video timestamp:** 
- **Relevant files:**
    - /src/auth/users.js
    - /src/routes/users.js

### REST API

- **One line description:** REST API for video analysis with endpoints for login, analyze, result, streaming and listing. Uses proper HTTP methods and status codes.
- **Video timestamp:** 00:54 - 03:40
- **Relevant files:**
    - /src/routes/videos.js
    - /src/controllers/videos.js

### Data types

- **One line description:** The application handles two kinds of data: unstructured video/snapshot files, and structured metadata stored in MariaDB.
- **Video timestamp:** 

#### First kind

- **One line description:** Uploaded videos and generated snapshots.
- **Type:** Unstructured
- **Rationale:** Media files are large and binary, better stored directly in filesystem for efficient streaming and access.
- **Video timestamp:** 00:54 - 03:40
- **Relevant files:**
    - /src/middleware/multer.js
    - /src/controllers/videos.js
    - /uploads/
    - /outputs/

#### Second kind

- **One line description:** Metadata about videos, owners, status, counts.
- **Type:** Structured (MariaDB)
- **Rationale:** Easy to query, update, and enforce ownership and status tracking.
- **Video timestamp:** 00:54 - 03:40
- **Relevant files:**
    - /src/models/doneVideos.js
    - /db.js

### CPU intensive task

- **One line description:** Video object detection and vehicle counting using YOLOv8 + OpenCV (runs per uploaded video).
- **Video timestamp:** 00:54 - 03:40
- **Relevant files:**
    - /scripts/carCounting.py
    - /src/controllers/videos.js

### CPU load testing

- **One line description:** Bash script repeatedly uploading test videos to generate >80% sustained CPU load for 5 minutes.
- **Video timestamp:** 03:30 
- **Relevant files:**
    - /cpu_load_test.sh

Additional criteria
------------------------------------------------

### Extensive REST API features

- **One line description:** Role-based access control (admin vs user), pagination for job listing, error handling middleware.
- **Video timestamp:** 00:00 - 00:54
- **Relevant files:**
    - /src/routes/videos.js
    - /src/controllers/videos.js
    - /src/auth/users.js

### External API(s)

- **One line description:** Not attempted
- **Video timestamp:**
- **Relevant files:**

### Additional types of data

- **One line description:** Snapshot images are generated whenever a vehicle crosses the counting line and stored on disk.
- **Type:** Unstructured
- **Rationale:** Snapshots provide visual verification of detections. They are stored as separate image files and returned to the client through the API.
- **Video timestamp:** mm:ss
- **Relevant files:**
    - /scripts/carCounting.py
    - /src/controllers/videos.js
    - /public/index.html
    - /outputs/<jobId>/

### Custom processing

- **One line description:** Car counting algorithm enhanced with snapshot saving per vehicle crossing the counting line.
- **Video timestamp:** mm:ss
- **Relevant files:**
    - /scripts/carCounting.py

### Infrastructure as code

- **One line description:** Docker Compose orchestrates Node app and MariaDB as services.
- **Video timestamp:** mm:ss
- **Relevant files:**
    - /docker-compose.yml

### Web client

- **One line description:** Simple frontend in index.html for login, video upload, and results display including video playback and image gallery.
- **Video timestamp:** mm:ss
- **Relevant files:**
    - /public/index.html

### Upon request

- **One line description:** Not attempted
- **Video timestamp:**
- **Relevant files:**
