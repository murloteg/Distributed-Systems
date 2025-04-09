# How to deploy application?

1. Go to the `/fault-tolerance/deploy` directory.
2. Run `docker compose -d --build` command.
3. Wait until the containers are created.
4. Go to the Bruno/Postman and try to send request by `POST http://localhost:3000/api/v1/hash/crack` endpoint.
   Example payload for this request:

```json
{
	"hash": "e2fc714c4727ee9395f324cd2e7f331f",
	"maxLength": 4
}
```

5. Check logs of containers (`docker logs manager-container -f` or `docker logs deploy-worker-app-* -f`)

---

## Scheme of distributed system

![DrawIO Scheme](./assets/fault-tolerance.svg)

---

## Test plan

_Stop manager and later stop RabbitMQ_

1. Start the docker containers from `deploy` directory (`docker compose up -d --build`).
2. Open [Mongo Express](http://localhost:8081/db/hashcracker_db/crack_requests) to check state of database.
3. Open [RabbitMQ Query Viewer](http://localhost:15672/#/queues) to check state of queries.
4. Open Bruno/Postman and send `POST http://localhost:3000/api/v1/hash/crack` request with big `maxLength` (e.g. _`maxLength: 5`_).
5. Open `manager-container` logs and make sure that manager sent tasks to workers.
6. Stop `manager-container`.
7. Open `deploy-worker-app-*` logs and make sure that worker finish task and sent result into result queue.
8. Stop `rabbitmq` container.
9. Restart `manager-container`.
10. Send another `POST http://localhost:3000/api/v1/hash/crack` request while `rabbitmq` container unavailable.
11. Wait few seconds and then restart `rabbitmq` container.
12. After manager connected to RabbitMQ it should receive pending results from workers.
13. After workers processed another manager's request they should sent new result to queue.
14. Check database state in Mongo Express.

---

_Stop mongo primary node and later stop worker_

1. Start the docker containers from `deploy` directory (`docker compose up -d --build`).
2. Open [Mongo Express](http://localhost:8081/db/hashcracker_db/crack_requests) to check state of database.
3. Open [RabbitMQ Query Viewer](http://localhost:15672/#/queues) to check state of queries.
4. Via `docker exec` command check state of replica set for MongoDB and define primary node.
5. Stop `mongo-node-*` container where `*` is number of primary node.
6. Via `docker exec` command check state of replica set for MongoDB again and define new primary node.
7. Open Bruno/Postman and send `POST http://localhost:3000/api/v1/hash/crack` request with big `maxLength` (e.g. _`maxLength: 5`_).
8. Open `manager-container` logs and make sure that manager sent tasks to workers.
9. Open `deploy-worker-app-*` and make sure that this worker got task.
10. Stop this worker container.
11. Make sure that someone from other workers got this task.
12. Open `manager-container` logs and check task status.
