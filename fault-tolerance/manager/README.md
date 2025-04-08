# About this service

- Manager service handle these requests: `POST /api/v1/hash/crack` and `GET /api/v1/hash/crack/status`.
- It uses `task_queue` to distribute tasks between workers.
- It uses `worker_response_queue` to handle workers answers.
- Also manager uses MongoDB replica set before and after request handling.
