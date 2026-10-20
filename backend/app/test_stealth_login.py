import asyncio
from pathlib import Path
from playwright.async_api import async_playwright
from playwright_stealth import Stealth

# Where we will save the cookies
SESSION_DIR = Path("./workspace/.auth")
SESSION_DIR.mkdir(parents=True, exist_ok=True)
state_file = SESSION_DIR / "github.json"

async def first_run_login():
    """Run 1: Opens browser, waits for human login, saves cookies."""
    print("🚀 Run 1: Starting fresh browser. Please log in to GitHub...")
    
    # Use Stealth Context Manager for the whole Playwright instance
    async with Stealth().use_async(async_playwright()) as p:
        # headless=False so you can see the screen and type your password
        browser = await p.chromium.launch(headless=False)
        context = await browser.new_context()
        page = await context.new_page()

        # Go to GitHub Login
        await page.goto("https://github.com/login")
        
        print("⏳ You have 60 seconds to log in...")
        
        # We wait for the user to login and reach the dashboard (which has the .dashboard element)
        try:
            await page.wait_for_selector("dashboard-feed", timeout=60000)
            print("✅ Login detected!")
        except Exception:
            print("⚠️ Did not detect login within 60 seconds, or the selector changed.")

        # Save the cookies and local storage!
        await context.storage_state(path=str(state_file))
        print(f"🍪 Session saved to {state_file.resolve()}")
        
        await browser.close()


async def second_run_bypass():
    """Run 2: Uses saved cookies to bypass login."""
    print("\n🚀 Run 2: Starting new browser using saved cookies...")
    
    if not state_file.exists():
        print("❌ No session file found.")
        return

    async with Stealth().use_async(async_playwright()) as p:
        browser = await p.chromium.launch(headless=False)
        
        # INJECT THE COOKIES into the new context
        context = await browser.new_context(storage_state=str(state_file))
        page = await context.new_page()

        # Go straight to the dashboard—you should already be logged in
        await page.goto("https://github.com/")
        print("✅ Reached GitHub. Check the browser window—you should be logged in without typing a password.")
        
        # Keep it open for a few seconds so you can see it
        await asyncio.sleep(5)
        
        await browser.close()


async def main():
    await first_run_login()
    await second_run_bypass()

if __name__ == "__main__":
    asyncio.run(main())