"""Generate the counsel review PDF using pyppeteer + system chromium."""
import asyncio
import os
from pyppeteer import connect, launch

URL = "https://active-project-4.preview.emergentagent.com/counsel-packet"
OUT = "/app/frontend/public/downloads/counsel-review-packet-2026-06-30.pdf"


async def main():
    browser = await launch(
        headless=True,
        executablePath="/usr/bin/google-chrome",
        args=[
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--hide-scrollbars",
        ],
        handleSIGINT=False,
        handleSIGTERM=False,
        handleSIGHUP=False,
    )
    try:
        page = await browser.newPage()
        await page.setViewport({"width": 900, "height": 1200})
        print("Loading page...")
        await page.goto(URL, {"waitUntil": "domcontentloaded", "timeout": 30000})
        try:
            await page.waitForSelector(
                '[data-testid="counsel-packet-page"]', {"timeout": 15000}
            )
        except Exception as e:
            print(f"Selector wait warning: {e}")
        await asyncio.sleep(4)  # let fonts + layout settle
        print("Generating PDF...")
        await page.pdf(
            {
                "path": OUT,
                "format": "Letter",
                "printBackground": True,
                "margin": {
                    "top": "0.6in",
                    "bottom": "0.75in",
                    "left": "0.6in",
                    "right": "0.6in",
                },
                "displayHeaderFooter": True,
                "headerTemplate": '<div style="display:none"></div>',
                "footerTemplate": (
                    '<div style="width:100%;font-size:8pt;color:#666;'
                    "text-align:center;font-family:Georgia,serif;"
                    'padding:0 0.6in;">Crafters Market — Trust &amp; '
                    "Policy Center v1 · Counsel Review Packet · Page "
                    '<span class="pageNumber"></span> of '
                    '<span class="totalPages"></span></div>'
                ),
            }
        )
        size = os.path.getsize(OUT)
        print(f"SUCCESS: {OUT} — {size} bytes ({size/1024:.1f} KB)")
    finally:
        await browser.close()


if __name__ == "__main__":
    asyncio.get_event_loop().run_until_complete(main())
