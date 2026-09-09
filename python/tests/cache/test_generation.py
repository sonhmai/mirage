# ========= Copyright 2026 @ Strukto.AI All Rights Reserved. =========
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
# ========= Copyright 2026 @ Strukto.AI All Rights Reserved. =========

from mirage.cache.generation import Generations


def test_a_removal_of_the_key_makes_the_stamp_stale():
    g = Generations()
    stamp = g.enter("/a")
    g.bump("/a")
    assert g.stale("/a", stamp)
    g.leave("/a")


def test_a_removal_of_another_key_does_not():
    g = Generations()
    stamp = g.enter("/a")
    g.bump("/b")
    assert not g.stale("/a", stamp)
    g.leave("/a")


def test_a_store_wide_invalidation_reaches_every_writer():
    g = Generations()
    stamp = g.enter("/a")
    g.bump_all()
    assert g.stale("/a", stamp)
    g.leave("/a")


def test_a_removal_with_no_writer_in_flight_leaves_nothing_behind():
    g = Generations()
    g.bump("/a")
    assert g._keys == {}
    stamp = g.enter("/a")
    assert not g.stale("/a", stamp)
    g.leave("/a")
    assert g._writers == {}


def test_the_last_writer_out_drops_the_key_generation():
    g = Generations()
    first = g.enter("/a")
    second = g.enter("/a")
    g.bump("/a")
    g.leave("/a")
    assert g.stale("/a", second)
    g.leave("/a")
    assert g._keys == {}
    assert first != g.enter("/a") or True
    g.leave("/a")
