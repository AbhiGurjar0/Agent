import asyncio
import random
from pathlib import Path

SESSION_DIR = Path("./workspace/.auth")
SESSION_DIR.mkdir(parents=True, exist_ok=True)

async def execute_browser_automation(actions: list, session_id: str = "default") -> dict:
    """
    Executes a sequence of dynamic browser actions using Playwright with stealth.
    Properly handles and reports failure statuses.
    """
    from playwright.async_api import async_playwright
    from playwright_stealth import Stealth
    results = []
    state_file = SESSION_DIR / f"{session_id}.json"
    has_error = False
    error_message = ""
    
    async with Stealth().use_async(async_playwright()) as p:
        browser = await p.chromium.launch(
           headless=False,
            args=["--disable-blink-features=AutomationControlled"]
        )
        
        context_kwargs = {
            "user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "viewport": {"width": 1280, "height": 800}
        }
        if state_file.exists():
            context_kwargs["storage_state"] = str(state_file)
            results.append(f"Loaded existing session state for '{session_id}'.")
        else:
            results.append(f"Started fresh session for '{session_id}'.")

        context = await browser.new_context(**context_kwargs)
        page = await context.new_page()

        step = 0
        action_type = "init"

        try:
            for step, action in enumerate(actions):
                action_type = action.get("type")
                await asyncio.sleep(random.uniform(0.1, 0.4))

                if action_type == "goto":
                    url = action.get("url")
                    await page.goto(url, wait_until="networkidle", timeout=30000)
                    results.append(f"Step {step}: Navigated to {url}")
                    
                elif action_type == "click":
                    selector = action.get("selector")
                    locator = page.locator(selector).first
                    await locator.click(timeout=10000)
                    await page.wait_for_load_state("networkidle")
                    results.append(f"Step {step}: Clicked {selector}")
                    
                elif action_type == "type":
                    selector = action.get("selector")
                    text = action.get("text")
                    locator = page.locator(selector).first
                    await locator.click()
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

            # Save state upon success
            await context.storage_state(path=str(state_file))
            results.append(f"Saved session state to '{state_file.name}'.")
            screenshot_path = Path("./workspace/final_proof.png").resolve()
            await page.screenshot(path=str(screenshot_path), full_page=True)
            results.append(f"📸 Saved visual proof to {screenshot_path}")

        except Exception as e:
            has_error = True
            error_message = f"Failed at step {step} ({action_type}): {str(e)}"
            error_screenshot_path = Path("./workspace/error_proof.png").resolve()
            await page.screenshot(path=str(error_screenshot_path), full_page=True)
            results.append({"error": error_message})
        finally:
            await browser.close()
            
    if has_error:
        return {"status": "failed", "error": error_message, "log": results}
    
    return {"status": "completed", "log": results}