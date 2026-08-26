# Linux/macOS counterpart of scripts/build-agent.ps1. Everything Go-related
# runs inside the golang image, so no toolchain is needed on the host.

# Single source of truth for the agent version: the VERSION file at the repo
# root. scripts/build-agent.ps1 reads the same file, and both stamp it into
# module.prop at package time, so nothing is edited in two places.
VERSION     ?= $(shell cat VERSION)
# Magisk compares versionCode, not the string. Derived so it always moves with
# the version: 0.1.2 -> 102.
VERSIONCODE := $(shell awk -F. '{ print $$1 * 10000 + $$2 * 100 + $$3 }' VERSION)
GO_IMAGE    ?= golang:1.23-alpine
ROOT        := $(shell pwd)
LDFLAGS     := -s -w -X main.version=$(VERSION)
DOCKER_GO   := docker run --rm -v "$(ROOT)/agent":/src -w /src $(GO_IMAGE)

# Bake an enrollment config into the module zip:
#   make module SERVER=https://magnemite.example.com TOKEN=abc123
SERVER ?=
TOKEN  ?=

.PHONY: help
help:
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

.PHONY: agent
agent: ## Cross-compile the agent for arm64, arm, amd64 and windows
	$(DOCKER_GO) sh -c '\
		set -e; mkdir -p bin; \
		CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -ldflags "$(LDFLAGS)" -o bin/magnemite-agent-linux-arm64 ./cmd/magnemite-agent; \
		CGO_ENABLED=0 GOOS=linux GOARCH=arm GOARM=7 go build -trimpath -ldflags "$(LDFLAGS)" -o bin/magnemite-agent-linux-arm ./cmd/magnemite-agent; \
		CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags "$(LDFLAGS)" -o bin/magnemite-agent-linux-amd64 ./cmd/magnemite-agent; \
		CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "$(LDFLAGS)" -o bin/magnemite-agent-windows-amd64.exe ./cmd/magnemite-agent; \
		ls -la bin'

.PHONY: agent-test
agent-test: ## Vet and test the agent
	$(DOCKER_GO) sh -c 'go vet ./... && go test ./...'

.PHONY: module
module: agent ## Package the Magisk module zip into dist/
	@rm -rf dist/module && mkdir -p dist/module/bin
	@cp magisk-module/* dist/module/
	@cp agent/bin/magnemite-agent-linux-arm64 dist/module/bin/
	@cp agent/bin/magnemite-agent-linux-arm dist/module/bin/
	@sed -i.bak -e 's/^version=.*/version=v$(VERSION)/' -e 's/^versionCode=.*/versionCode=$(VERSIONCODE)/' dist/module/module.prop && rm -f dist/module/module.prop.bak
	@if [ -n "$(SERVER)" ] && [ -n "$(TOKEN)" ]; then \
		printf '{\n  "serverUrl": "%s",\n  "enrollmentToken": "%s"\n}\n' "$(SERVER)" "$(TOKEN)" > dist/module/config.json; \
		echo "  baked enrollment config for $(SERVER)"; \
	elif [ -n "$(SERVER)$(TOKEN)" ]; then \
		echo "SERVER and TOKEN must be set together"; exit 1; \
	fi
	@docker run --rm -v "$(ROOT)/dist":/work -w /work alpine sh -c \
		"apk add --no-cache zip >/dev/null && cd module && zip -r ../magnemite-agent-$(VERSION).zip . -x '.*'"
	@rm -rf dist/module
	@echo "Module: dist/magnemite-agent-$(VERSION).zip"

.PHONY: up
up: ## Start the whole stack
	docker compose up -d --build

.PHONY: down
down: ## Stop the stack
	docker compose down

.PHONY: logs
logs: ## Follow hub and web logs
	docker compose logs -f hub web

.PHONY: migrate
migrate: ## Apply database migrations inside the hub container
	docker compose exec hub pnpm --filter @magnemite/db run deploy

.PHONY: seed
seed: ## Seed the admin user, app target and first enrollment token
	docker compose exec hub pnpm --filter @magnemite/db run seed

.PHONY: typecheck
typecheck: ## Typecheck hub and web
	pnpm --filter @magnemite/hub typecheck && pnpm --filter @magnemite/web typecheck
