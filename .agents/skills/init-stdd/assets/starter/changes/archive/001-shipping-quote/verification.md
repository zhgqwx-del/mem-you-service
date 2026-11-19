# 标准运费报价验收记录

用例位于 [tests/acceptance/test_shipping_quote.py](../../../tests/acceptance/test_shipping_quote.py)。

| 需求 ID | 验收场景 | 用例 | 定向测试结果 |
| --- | --- | --- | --- |
| `REQ-SHIP-001` | [AC-SHIP-001](../../../specs/shipping/spec.md#ac-ship-001) | `test_ac_ship_001_below_threshold` | 通过 |
| `REQ-SHIP-001` | [AC-SHIP-002](../../../specs/shipping/spec.md#ac-ship-002) | `test_ac_ship_002_at_threshold` | 通过 |
| `REQ-SHIP-001` | [AC-SHIP-003](../../../specs/shipping/spec.md#ac-ship-003) | `test_ac_ship_003_above_threshold` | 通过 |
| `REQ-SHIP-002` | [AC-SHIP-004](../../../specs/shipping/spec.md#ac-ship-004) | `test_ac_ship_004_invalid_subtotal` | 通过 |

## 本地证据

- 运行环境为 macOS、Python 3.9.6 和 GNU Make 3.81。
- `make test-acceptance` 与 `make check` 各运行四个测试方法，均通过。
- 在隔离副本将 `>=` 改为 `>` 后，`make test-acceptance` 以非零状态退出，仅 `AC-SHIP-002` 失败，断言显示实际运费 800 分、预期 0 分。
