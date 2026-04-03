# RootX Tool Test Prompts

Run each prompt sequentially. Do NOT make any code changes to existing files. Only create temporary test files in a `test-output/` directory. Clean them up at the end. and also if the prompt fails skip it and move to the next prompt 

---

## 1. write_file
Create a file called `test-output/hello.txt` with the content "Hello RootX Test!"

## 2. read_file
Read the contents of `test-output/hello.txt` and confirm what it says.

## 3. edit_file
In `test-output/hello.txt`, replace "Hello RootX Test!" with "Hello RootX - Edited!"

## 4. list_files
List all files in the current directory.

## 5. search_files
Search for all files matching `*.js` in the project.

## 6. search_content
Search the codebase for the text "getToolsForRole".

## 7. run_command
Run `node --version` and report the output.

## 8. websearch
Search the web for "JavaScript ES2025 features" and summarize the top 3 results.

## 9. webfetch
Fetch https://example.com and show me the page title.

## 10. codesearch
Search for documentation on "Express.js middleware" and summarize what you find.

## 11. todowrite
Create a todo list with these items:
- Setup test environment (high)
- Run tool tests (high)
- Clean up test files (medium)

## 12. todoread
Read the current todo list and show it to me.

## 13. batch
In parallel: list files in the current directory AND run `echo "batch test successful"`.

## 14. apply_patch
Apply a patch to create `test-output/patch-test.txt` with the content "Created via patch."

## 15. codebase_search
Search for "agentController" in the codebase and report where it's used.

## 16. finish_task
Report: "All 15 tools tested successfully. No permanent changes made."

---

## Cleanup
Delete the `test-output/` directory and all files inside it.
