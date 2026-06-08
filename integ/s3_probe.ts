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

import { S3Client } from "@aws-sdk/client-s3";

const calls = new Map<string, number>();

interface ProbedProto {
  send: (
    this: unknown,
    command: unknown,
    ...rest: unknown[]
  ) => Promise<unknown>;
  __mirageProbed?: boolean;
}

const proto = S3Client.prototype as unknown as ProbedProto;
if (proto.__mirageProbed !== true) {
  const orig = proto.send;
  proto.send = function (
    this: unknown,
    command: unknown,
    ...rest: unknown[]
  ): Promise<unknown> {
    const ctorName =
      (command as { constructor?: { name?: string } })?.constructor?.name ??
      "Unknown";
    const op = ctorName.endsWith("Command")
      ? ctorName.slice(0, -"Command".length)
      : ctorName;
    calls.set(op, (calls.get(op) ?? 0) + 1);
    return orig.call(this, command, ...rest);
  };
  proto.__mirageProbed = true;
}

export function resetCalls(): void {
  calls.clear();
}

export function getCalls(): Record<string, number> {
  return Object.fromEntries(calls);
}
