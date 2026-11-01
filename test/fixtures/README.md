# Legacy book compatibility fixture

`legacy-compatibility/` was generated and read back using the original book service at commit `b9c04cd`, before removing the Electron application from this branch. It contains synthetic prose and notes only. Chapter IDs and the creation timestamp were fixed for reproducibility; the author guidance was shortened and trailing blank lines were normalized.

Flutter tests copy this fixture into a temporary directory before opening or editing it. The fixture preserves the original `assisted-writer-1` file layout without requiring Node or retaining the old application code. The earlier migration also verified that the Node reader could open Flutter-created books.
