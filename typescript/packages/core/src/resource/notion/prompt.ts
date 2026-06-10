// ========= Copyright 2026 @ Strukto.AI All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ========= Copyright 2026 @ Strukto.AI All Rights Reserved. =========

export const NOTION_PROMPT = `{prefix}
  pages/
    <page-title>__<page-id>/
      page.json
      <child-page-title>__<child-id>/
        page.json
  Hierarchical page tree. cat page.json shows metadata, the page body
  rendered as markdown, and raw blocks (nested blocks under "children").

  <page-title> is sanitized; don't construct it, ls the parent dir.`

export const NOTION_WRITE_PROMPT = `  Write commands:
    notion-page-create --parent <parent-path> --title "title"
    notion-block-append --params '{"block_id":"..."}' --json '{"children":[...]}'
    notion-comment-add --json '{"parent":{"page_id":"..."},"rich_text":[{"text":{"content":"Comment"}}]}'`
