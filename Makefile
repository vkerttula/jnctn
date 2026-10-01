# Requires Docker + the devcontainer CLI:
#   npm i -g @devcontainers/cli

.PHONY: start mongo stop rebuild status

## Start (and build) the devcontainer
start:
	devcontainer up --workspace-folder .

## Open mongosh against the devcontainer's MongoDB
mongo:
	docker exec -it $$(docker ps -q --filter "label=com.docker.compose.service=db" | head -1) mongosh

## Stop the devcontainer and its MongoDB container
stop:
	-docker stop $$(docker ps -q --filter "label=devcontainer.local_folder=$(CURDIR)")
	-docker compose -f .devcontainer/docker-compose.yml -p $(notdir $(CURDIR))_devcontainer down

## Rebuild from scratch (after changing .devcontainer config)
rebuild:
	devcontainer up --workspace-folder . --remove-existing-container

## Show devcontainer + MongoDB containers
status:
	@docker ps --filter "label=devcontainer.local_folder=$(CURDIR)" \
		--filter "label=com.docker.compose.service=db"
