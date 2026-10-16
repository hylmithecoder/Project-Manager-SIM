.PHONY: build build-web embed-web build-bin run start-bin db-setup db-seed test lint

BINARY_OUT := build/projectmanager

build-web:
	STATIC_EXPORT=true bun run next build

embed-web:
	bun run server/scripts/embed-static.ts

build-bin: embed-web
	mkdir -p build
	bun build --compile --minify --bytecode server/index.ts --outfile $(BINARY_OUT)
	ls -lh $(BINARY_OUT)

build: build-web build-bin

run:
	bun run server/dev.ts

start-bin:
	./$(BINARY_OUT)

db-setup:
	bun run server/database/scheme.ts

db-seed:
	bun run server/database/seeder.ts

test:
	bun test

lint:
	bun run lint
