# GitHub Automation Skill

This skill provides deterministic, high-speed methods for executing GitHub operations on macOS. 

---

## Priority 1: GitHub CLI (`gh`) — PREFERRED (1-Step Execution)

Always attempt execution using the official `gh` CLI first.

### 1. Verification & Status
```bash
gh auth status
```

### 2. Repository Management
* **Create public repo and push current folder**:
  ```bash
  gh repo create <repo-name> --public --source=. --remote=origin --push
  ```
* **Create empty public repo**:
  ```bash
  gh repo create <repo-name> --public --confirm
  ```
* **Create empty private repo**:
  ```bash
  gh repo create <repo-name> --private --confirm
  ```
* **Create and clone locally**:
  ```bash
  gh repo create <repo-name> --public --clone
  ```
* **Clone an existing repo**:
  ```bash
  gh repo clone <owner>/<repo-name>
  ```
* **List repositories**:
  ```bash
  gh repo list --limit 15
  ```
* **Open repo in default browser**:
  ```bash
  gh repo view --web
  ```
* **Delete repository**:
  ```bash
  gh repo delete <owner>/<repo-name> --yes
  ```

### 3. Issues & Pull Requests
* **Create an issue**:
  ```bash
  gh issue create --title "<title>" --body "<body>"
  ```
* **List open issues**:
  ```bash
  gh issue list
  ```
* **Close an issue**:
  ```bash
  gh issue close <issue-number>
  ```
* **Create a Pull Request**:
  ```bash
  gh pr create --title "<title>" --body "<body>"
  ```
* **List Pull Requests**:
  ```bash
  gh pr list
  ```
* **Merge Pull Request**:
  ```bash
  gh pr merge <pr-number> --auto --squash
  ```

### 4. Gists & Releases
* **Create a secret Gist**:
  ```bash
  gh gist create <file-path>
  ```
* **Create a public Gist**:
  ```bash
  gh gist create <file-path> --public
  ```
* **Create a Release**:
  ```bash
  gh release create v1.0.0 --title "v1.0.0 Release" --notes "Release notes text"
  ```

---

## Priority 2: Standard Git Terminal Workflow

Use standard `git` commands when initializing local repositories or syncing local commits.

### Push Local Code to GitHub
```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin [https://github.com/](https://github.com/)<username>/<repo-name>.git
git push -u origin main
```

---

## Priority 3: Browser Fallback (Last Resort)

Use this method ONLY if the `gh` CLI is not installed or unauthenticated.

### 1. Open Pre-filled Creation Form
```bash
open "[https://github.com/new?name=](https://github.com/new?name=)<repo-name>&description=<description>"
```

### 2. Submit Form via AppleScript
```python
import subprocess, time

applescript = """
tell application "Brave Browser" to activate
delay 3

tell application "Brave Browser"
    try
        execute front window's active tab javascript "document.querySelector('button[type=\"submit\"]').click()"
    on error
        tell application "System Events"
            repeat 8 times
                keystroke tab
                delay 0.1
            end repeat
            keystroke return
        end tell
    end try
end tell
"""
subprocess.run(["osascript", "-e", applescript])
```