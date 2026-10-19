# Reference notice

The CSDN, Toutiao and Zhihu editor integrations were independently implemented after studying the editor flow and selector descriptions in Omnipub (https://github.com/addozhang/omnipub). It does not include Omnipub's cookie access, internal write-API fallback, draft deletion or generated public URL behavior. Its reference license is preserved here for attribution.

MIT License

Copyright (c) 2026 Addo Zhang

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

Additional implementation research (page structure only; no cookie or private write-API implementation included):

- dreammis/social-auto-upload: https://github.com/dreammis/social-auto-upload (MIT, Copyright 2023 dreammis). Douyin image-upload workflow informed the independent adapter.
- xpzouying/xiaohongshu-mcp: https://github.com/xpzouying/xiaohongshu-mcp . Public page selector and workflow descriptions were inspected; no source implementation is copied or bundled.

The MIT permission and warranty terms reproduced above also accompany the referenced dreammis material with its stated copyright. These projects are references, not official platform APIs or approval of this product.
