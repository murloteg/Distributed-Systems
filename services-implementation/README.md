# How to deploy application?

1. Go to the `/services-implementation/deploy` directory
2. Run `docker compose -d --build` command
3. Wait until the containers are created
4. Go to the Bruno/Postman and try to send request by `POST http://localhost:3000/api/v1/hash/crack` endpoint
5. Check logs of containers (`docker logs manager-container -f` or `docker logs worker-container -f`)
