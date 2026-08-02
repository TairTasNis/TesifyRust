import urllib.request, re
req = urllib.request.Request("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M", headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/110.0.0.0'})
html = urllib.request.urlopen(req).read().decode('utf-8')
bundles = re.findall(r'https://open.spotifycdn.com/cdn/build/web-player/[^\"]+\.js', html)

for b in set(bundles):
    try:
        bsrc = urllib.request.urlopen(urllib.request.Request(b, headers={'User-Agent': 'Mozilla/5.0'})).read().decode('utf-8')
        # fetchPlaylist is a known query name
        if 'fetchPlaylist' in bsrc or 'playlist' in bsrc.lower():
            matches = list(re.finditer(r'([a-f0-9]{32})', bsrc))
            for m in matches:
                h = m.group(1)
                idx = bsrc.find(h)
                ctx = bsrc[max(0, idx-50):min(len(bsrc), idx+50)]
                if 'query' in ctx or 'id' in ctx or 'operationName' in ctx or 'hash' in ctx:
                    print('Found hash:', h, 'ctx:', ctx)
    except Exception as e:
        pass
