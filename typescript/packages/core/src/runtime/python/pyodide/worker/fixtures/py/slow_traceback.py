import time
import traceback

_original = traceback.print_exc


def slow_traceback(*args, **kwargs):
    traceback.print_exc = _original
    time.sleep(0.1)
    _original(*args, **kwargs)


traceback.print_exc = slow_traceback
while True:
    pass
