package preferences

import (
	"os"

	"github.com/ethan-blue/open-code-go-tools/internal/fileutil"
)

func atomicWriteFile(path string, data []byte, perm os.FileMode) error {
	return fileutil.AtomicWriteFile(path, data, perm)
}
