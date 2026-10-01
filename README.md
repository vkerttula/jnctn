# jnctn

## Development

The devcontainer (`.devcontainer/`) provides Node.js + MongoDB. With Docker and the
devcontainer CLI (`npm i -g @devcontainers/cli`) installed:

```bash
make start    # build & start the devcontainer
make shell    # shell into it
make mongo    # open mongosh
make stop     # stop everything
make rebuild  # rebuild after changing .devcontainer
```

MongoDB is reachable at `mongodb://localhost:27017` inside the container, and the
same address on the host via the forwarded port. From VS Code, use
"Dev Containers: Reopen in Container" instead of the Makefile.
