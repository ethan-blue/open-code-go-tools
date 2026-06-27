//go:build !windows

package main

func setWindowsUserEnvironment(name, value string) error {
	return nil
}

func setWindowsUserEnvironmentBatch(values map[string]string) error {
	return nil
}

func unsetWindowsUserEnvironment(name string) error {
	return nil
}

func unsetWindowsUserEnvironmentBatch(names []string) error {
	return nil
}

func getWindowsUserEnvironment(name string) (string, bool) {
	return "", false
}
