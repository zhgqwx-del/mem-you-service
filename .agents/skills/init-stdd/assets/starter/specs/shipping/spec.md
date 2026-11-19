# 标准运费报价规范

结算流程使用 `shipping.quote.quote_shipping(subtotal_fen)` 报价。输入为计入免运费门槛的商品小计，输出为运费，金额均以分为单位。优惠计算、配送区域和加急费用另行定义。

## 需求

### REQ-SHIP-001

合法商品小计低于 9,900 分时，报价 800 分。小计达到或超过 9,900 分时，报价 0 分。

### REQ-SHIP-002

输入须为非负的 Python 内置 `int`。负数、小数、字符串、布尔值和空值等无效输入应抛出 `ValueError`。

## 验收场景

### AC-SHIP-001

关联 [REQ-SHIP-001](#req-ship-001)。

- **Given** 商品小计为 0 分或 9,899 分
- **When** 请求标准运费报价
- **Then** 返回 800 分

### AC-SHIP-002

关联 [REQ-SHIP-001](#req-ship-001)。

- **Given** 商品小计为 9,900 分
- **When** 请求标准运费报价
- **Then** 返回 0 分

### AC-SHIP-003

关联 [REQ-SHIP-001](#req-ship-001)。

- **Given** 商品小计为 9,901 分
- **When** 请求标准运费报价
- **Then** 返回 0 分

### AC-SHIP-004

关联 [REQ-SHIP-002](#req-ship-002)。

- **Given** 商品小计为 `-1`、`9900.0`、`"9900"`、`True` 或 `None`
- **When** 请求标准运费报价
- **Then** 抛出 `ValueError`
