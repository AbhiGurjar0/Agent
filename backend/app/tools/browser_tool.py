import asyncio
import random
from pathlib import Path
from playwright.async_api import async_playwright
# Use the new v2 API for playwright-stealth
from playwright_stealth import Stealth

SESSION_DIR = Path("./workspace/.auth")
SESSION_DIR.mkdir(parents=True, exist_ok=True)

async def execute_browser_automation(actions: list, session_id: str = "default") -> dict:
    """
    Executes a sequence of dynamic browser actions using Playwright.
    Persists cookies and local storage across runs using storage_state with stealth features.
    """
    results = []
    state_file = SESSION_DIR / f"{session_id}.json"
    
    # FIX: Wrap async_playwright() in Stealth().use_async()
    async with Stealth().use_async(async_playwright()) as p:
        # Launch Chromium with anti-automation flags disabled
        browser = await p.chromium.launch(
            headless=True,
            args=["--disable-blink-features=AutomationControlled"]
        )
        
        # Load existing cookies / state if available
        context_kwargs = {
            "user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "viewport": {"width": 1280, "height": 800}
        }
        if state_file.exists():
            context_kwargs["storage_state"] = str(state_file)
            results.append(f"Loaded existing session state for '{session_id}'.")
        else:
            results.append(f"Started fresh session for '{session_id}'.")

        # Stealth patches are automatically applied to contexts spawned here
        context = await browser.new_context(**context_kwargs)
        page = await context.new_page()

        step = 0
        action_type = "init"

        try:
            for step, action in enumerate(actions):
                action_type = action.get("type")
                
                # Introduce slight humanized delays between actions (100ms - 400ms)
                await asyncio.sleep(random.uniform(0.1, 0.4))

                if action_type == "goto":
                    url = action.get("url")
                    await page.goto(url, wait_until="networkidle", timeout=30000)
                    results.append(f"Step {step}: Navigated to {url}")
                    
                elif action_type == "click":
                    selector = action.get("selector")
                    # Use Locator for better auto-waiting and resilience
                    locator = page.locator(selector).first
                    await locator.click(timeout=10000)
                    await page.wait_for_load_state("networkidle")
                    results.append(f"Step {step}: Clicked {selector}")
                    
                elif action_type == "type":
                    selector = action.get("selector")
                    text = action.get("text")
                    locator = page.locator(selector).first
                    await locator.click()
                    # Humanized typing speed (50ms - 120ms per key)
                    await locator.type(text, delay=random.randint(50, 120))
                    results.append(f"Step {step}: Typed into {selector}")
                    
                elif action_type == "extract_text":
                    selector = action.get("selector")
                    locator = page.locator(selector).first
                    await locator.wait_for(state="visible", timeout=5000)
                    text = await locator.inner_text()
                    results.append({f"Step {step}_extracted_data": text.strip()})
                    
                elif action_type == "wait_for":
                    selector = action.get("selector")
                    await page.locator(selector).first.wait_for(state="visible", timeout=10000)
                    results.append(f"Step {step}: Found {selector}")

            # Save state (Cookies + LocalStorage) upon success
            await context.storage_state(path=str(state_file))
            results.append(f"Saved session state to '{state_file.name}'.")

        except Exception as e:
            results.append({"error": f"Failed at step {step} ({action_type}): {str(e)}"})
        finally:
            await browser.close()
            
    return {"status": "completed", "log": results}