<div align="center">
  <h1>Egern Geosite</h1>
  <p>
    中文 | <a href="./README.md">English</a>
  </p>
  <p>自动转换 <code>Loyalsoldier/v2ray-rules-dat</code> 数据集（geosite + geoip）为 Egern 可直接使用的规则集。</p>
  <p>
    <a href="https://egern.slinet.moe"><strong>打开可视化面板</strong></a>
  </p>
</div>

<p align="center">
  <img src="./docs/assets/panel-dashboard.png" alt="Egern Geosite 面板" width="600" />
</p>

## 直接使用

1. 打开可视化面板：https://egern.slinet.moe。
2. 搜索并选择数据集。
3. 复制页面给出的原始链接。
4. 在 Egern 的 `rule_set` 规则中引用。

如果你要直接使用规则链接，格式是：

- 推荐规则路径：`https://egern.slinet.moe/geosite/:name_with_filter.yaml`
- 兼容路径（同样可用）：`https://egern.slinet.moe/geosite/:name_with_filter`
- GeoIP 规则路径：`https://egern.slinet.moe/geoip/:country_code.yaml`
- GeoIP 跳过 DNS 解析：`https://egern.slinet.moe/geoip/:country_code.yaml?no_resolve=true`

`name_with_filter` 有两种：

- 不带 filter：`apple`
  返回 `apple` 这个数据集的完整规则。
- 带 filter：`apple@cn`
  只返回带 `@cn` 标签的规则。

`country_code` 示例：

- `cn`
  返回 `CN` 这个 GeoIP 数据集转换后的 CIDR 规则。

Egern 引用示例：

```yaml
rules:
  - rule_set:
      match: "https://egern.slinet.moe/geosite/apple@cn.yaml"
      policy: DIRECT
      update_interval: 86400
  - rule_set:
      match: "https://egern.slinet.moe/geosite/strict/proxy-list.yaml"
      policy: Proxy
      update_interval: 86400
  - rule_set:
      match: "https://egern.slinet.moe/geoip/cn.yaml?no_resolve=true"
      policy: DIRECT
      update_interval: 86400
```

## 高级使用

### API

- `GET /geosite`
- `GET /geosite/:name_with_filter` 或 `GET /geosite/:name_with_filter.yaml`（默认模式：`balanced`）
- `GET /geosite/:mode/:name_with_filter` 或 `GET /geosite/:mode/:name_with_filter.yaml`
- `GET /geoip`
- `GET /geoip/:country_code` 或 `GET /geoip/:country_code.yaml`
- `GET /geoip/:country_code?no_resolve=true` 或 `GET /geoip/:country_code.yaml?no_resolve=true`
- `GET /geosite-srs/:name` 或 `GET /geosite-srs/:name.srs`
- `GET /geosite-mrs/:name` 或 `GET /geosite-mrs/:name.mrs`

### 模式说明

- `strict`：仅接受无损 regex 转换
- `balanced`：可控降级（默认）
- `full`：最宽松转换（覆盖范围最大，误匹配风险也最高）

## 维护者说明

本地开发：

```bash
pnpm install
pnpm build
pnpm test
pnpm panel:dev
pnpm worker:dev
```

部署：

```bash
pnpm panel:deploy
pnpm worker:deploy
```

技术架构文档：[docs/architecture.md](./docs/architecture.md)
