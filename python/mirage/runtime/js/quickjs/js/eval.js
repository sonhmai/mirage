const __mirage_request = JSON.parse(scriptArgs[0]);
const __mirage_sentinel = scriptArgs[1];
const __mirage_inputs = __mirage_request.inputs;
for (const __k of Object.keys(__mirage_inputs))
  globalThis[__k] = __mirage_inputs[__k];
let __mirage_payload;
try {
  const __mirage_value = (0, eval)(__mirage_request.code);
  __mirage_payload =
    { value: __mirage_value === undefined ? null : __mirage_value };
} catch (__e) {
  __mirage_payload = { error: {
    name: (__e && __e.name) || 'Error',
    message: (__e && __e.message) || String(__e),
  } };
}
std.out.puts('\n' + __mirage_sentinel + JSON.stringify(__mirage_payload) + '\n');
