from playwright.sync_api import sync_playwright

html_path = '/Users/bytedance/workspace/study/beeclaw/workspace/hello-beeclaw.html'

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1280, 'height': 900})
    page.goto(f'file://{html_path}')
    page.wait_for_load_state('networkidle')
    page.screenshot(path='/Users/bytedance/workspace/study/beeclaw/output/hello-beeclaw.png', full_page=True)
    print('Screenshot saved to output/hello-beeclaw.png')
    browser.close()
