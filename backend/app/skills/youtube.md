# YouTube Automation Skill

This skill provides programmatic methods to search and play YouTube videos on macOS without relying on UI vision.

---

## Priority 1: Smart Browser Playback (Python Automation)

When the user asks to play a song or video on YouTube, do NOT just open the search results page. You must dynamically fetch the correct video and force it to play using AppleScript.

**Step 1:** Use `manage_local_files` (action="write") to create `play_yt.py` with this exact code:

```python
import urllib.request, urllib.parse, re, os, sys, time, subprocess

query = urllib.parse.quote(sys.argv[1])
search_url = f"[https://www.youtube.com/results?search_query=](https://www.youtube.com/results?search_query=){query}"
req = urllib.request.Request(search_url, headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"})

try:
    html = urllib.request.urlopen(req).read().decode('utf-8')
    video_ids = re.findall(r'/watch\?v=([a-zA-Z0-9_-]{11})', html)
    
    if video_ids:
        video_url = f"[https://www.youtube.com/watch?v=](https://www.youtube.com/watch?v=){video_ids[0]}"
        os.system(f"open '{video_url}'")
        time.sleep(2.5)
        
        applescript = """
        tell application "System Events"
            set frontApp to name of first application process whose frontmost is true
        end tell

        if frontApp is in {"Brave Browser", "Google Chrome", "Chromium", "Arc"} then
            tell application frontApp
                try
                    set isPaused to execute front window's active tab javascript "document.querySelector('video') ? document.querySelector('video').paused : true"
                    if isPaused is true or isPaused is "true" then
                        execute front window's active tab javascript "document.querySelector('video').play()"
                        delay 0.3
                        set isStillPaused to execute front window's active tab javascript "document.querySelector('video').paused"
                        if isStillPaused is true or isStillPaused is "true" then
                            tell application "System Events" to keystroke "k"
                        end if
                    end if
                on error
                    tell application "System Events" to keystroke "k"
                end try
            end tell
        else if frontApp is "Safari" then
            tell application "Safari"
                try
                    set isPaused to do JavaScript "document.querySelector('video') ? document.querySelector('video').paused : true" in document 1
                    if isPaused is true or isPaused is "true" then
                        do JavaScript "document.querySelector('video').play()" in document 1
                    end if
                on error
                    tell application "System Events" to keystroke "k"
                end try
            end tell
        else
            tell application "System Events" to keystroke "k"
        end if
        """
        subprocess.run(["osascript", "-e", applescript])
    else:
        os.system(f"open '{search_url}'")
except Exception:
    os.system(f"open '{search_url}'")
```

**Step 2:** Use `run_terminal_command` to execute the script:
```bash
python3 play_yt.py "name of the song or video"
```