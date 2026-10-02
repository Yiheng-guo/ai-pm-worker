"""Public search discovery. Search snippets are not used as factual evidence."""
import json
import sys
from ddgs import DDGS

query = sys.argv[1]
results = DDGS(timeout=15).text(query, max_results=4)
print(json.dumps([{"title": x.get("title"), "url": x.get("href")} for x in results], ensure_ascii=False))
