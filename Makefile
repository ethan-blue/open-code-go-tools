.PHONY: build test clean lint

VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
LDFLAGS := -s -w -X github.com/ethan-blue/open-code-go-tools/internal/version.Version=$(VERSION)
BINARY  := bin/ocgt.exe

build:
	go build -ldflags "$(LDFLAGS)" -o $(BINARY) .

test:
	go test ./...

test-verbose:
	go test -v ./...

clean:
	rm -rf bin/ dist/

lint:
	go vet ./...

fmt:
	gofmt -w .

tidy:
	go mod tidy

run: build
	./$(BINARY) serve