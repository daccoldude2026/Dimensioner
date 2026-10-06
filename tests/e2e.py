"""End-to-end smoke test in a real browser. Run: python3 tests/e2e.py  (needs: pip install playwright && playwright install chromium)"""
import http.server, threading, socketserver, os, sys, functools, re
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
class Quiet(Handler.func):
    def log_message(self, *a): pass
srv = socketserver.TCPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=ROOT))
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
M, P = 40, 40  # sample plan margin and grid pitch (px)
fails = []
def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + (f"  {extra}" if extra else ""))
    if not cond: fails.append(name)

with sync_playwright() as pw:
    exe = os.environ.get("CHROMIUM")  # optional override
    b = pw.chromium.launch(executable_path=exe) if exe else pw.chromium.launch()
    pg = b.new_page(viewport={"width": 2000, "height": 1300}, accept_downloads=True)
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"http://127.0.0.1:{port}/index.html")
    pg.click("#sample")
    pg.wait_for_function("window.__gd && window.__gd.st.img")
    pg.click("#autograd")
    pg.wait_for_function("window.__gd.st.scale.sx")
    sx = pg.evaluate("window.__gd.st.scale.sx")
    check("auto-detect scale = 40px per 24in", abs(sx - 40/24) < 0.01, f"sx={sx:.4f}")

    def click_img(x, y):
        r = pg.evaluate("""([x,y]) => { const cv=document.getElementById('cv'); const st=window.__gd.st;
            const pad=Math.round(0.07*Math.max(st.w,st.h)); const r=cv.getBoundingClientRect();
            return [r.left+(pad+x)*r.width/cv.width, r.top+(pad+y)*r.height/cv.height]; }""", [x, y])
        pg.mouse.click(r[0], r[1])

    # linear: room 1 spans grid 2..14 horizontally = 24 ft
    click_img(M+2*P, M+11*P); click_img(M+14*P, M+11*P)
    lab = pg.evaluate("window.__gd.labelFor(window.__gd.st.dims[0])")
    check("linear dimension reads 24'-0\"", lab == "24'-0\"", lab)
    # vertical: room 1 is 2..10 vertically = 16 ft
    click_img(M+15*P, M+2*P); click_img(M+15*P, M+10*P)
    lab = pg.evaluate("window.__gd.labelFor(window.__gd.st.dims[1])")
    check("vertical dimension reads 16'-0\"", lab == "16'-0\"", lab)
    # diameter: circle at (25,17) radius 3 squares = 12 ft diameter
    pg.click("#mdia")
    click_img(M+22*P, M+17*P); click_img(M+28*P, M+17*P)
    lab = pg.evaluate("window.__gd.labelFor(window.__gd.st.dims[2])")
    check("diameter reads Ø12'-0\"", lab == "Ø12'-0\"", lab)
    # units toggle to inches
    pg.select_option("#units", "in")
    lab = pg.evaluate("window.__gd.labelFor(window.__gd.st.dims[0])")
    check("inches toggle reads 288\"", lab == '288"', lab)
    pg.select_option("#units", "ft")
    # grid labels on
    pg.check("#labels")
    pg.wait_for_timeout(200)
    os.makedirs(os.path.join(ROOT, "docs"), exist_ok=True)
    pg.screenshot(path=os.path.join(ROOT, "docs", "screenshot.png"))
    # exports
    with pg.expect_download() as d: pg.click("#png")
    data = open(d.value.path(), "rb").read()
    check("PNG export", data[:8] == b"\x89PNG\r\n\x1a\n", f"{len(data)} bytes")
    pg.click("#addpage"); pg.click("#addpage")
    with pg.expect_download() as d: pg.click("#pdf")
    data = open(d.value.path(), "rb").read()
    check("PDF export has 2 pages", data[:5] == b"%PDF-" and data.count(b"/Type /Page ") == 2, f"{len(data)} bytes")
    open("/tmp/gd_test.pdf", "wb").write(data)
    # undo
    n = pg.evaluate("window.__gd.st.dims.length"); pg.click("#undo")
    check("undo removes last dimension", pg.evaluate("window.__gd.st.dims.length") == n-1)
    # PDF input through pdf.js
    pg.set_input_files("#file", os.path.join(ROOT, "samples", "sample-plan.pdf"))
    pg.wait_for_function("document.getElementById('fileinfo').textContent.includes('page 1')", timeout=30000)
    check("PDF input loads via pdf.js", "page 1" in pg.inner_text("#fileinfo"), pg.inner_text("#fileinfo"))
    check("no page errors", not errs, "; ".join(errs))
    b.close()
srv.shutdown()
print("\nFAILED: " + ", ".join(fails) if fails else "\nAll e2e checks passed")
sys.exit(1 if fails else 0)
