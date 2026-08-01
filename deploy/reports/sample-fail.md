<!-- backup-test-pr-comment -->

## ❌ 故障排查场景自动化测试 — 存在失败

<table>
  <thead>
    <tr>
      <th>指标</th>
      <th>值</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>状态</td>
      <td><strong>FAIL</strong></td>
    </tr>
    <tr>
      <td>测试项</td>
      <td>37</td>
    </tr>
    <tr>
      <td>通过</td>
      <td>35</td>
    </tr>
    <tr>
      <td>失败</td>
      <td>2</td>
    </tr>
    <tr>
      <td>警告</td>
      <td>1</td>
    </tr>
    <tr>
      <td>通过率</td>
      <td>94.6%</td>
    </tr>
    <tr>
      <td>耗时</td>
      <td>285s</td>
    </tr>
    <tr>
      <td>数据库</td>
      <td><code>neighborhood_help@mysql</code></td>
    </tr>
    <tr>
      <td>时间</td>
      <td>2026-08-01T11:00:00+08:00</td>
    </tr>
  </tbody>
</table>

### 🔴 失败项详情

**TC-05: 备份文件损坏检测**

- ❌ verify-backup.sh 未能检测到损坏的备份文件

**TC-09: Cron 任务实际触发验证**

- ❌ Cron 任务在 75s 内未触发

### 📋 各场景结果

<table>
  <thead>
    <tr>
      <th>场景</th>
      <th>描述</th>
      <th>状态</th>
      <th>通过</th>
      <th>失败</th>
      <th>警告</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>TC-01</td>
      <td>Cron 进程状态验证</td>
      <td>✅ PASS</td>
      <td>5</td>
      <td>0</td>
      <td>0</td>
    </tr>
    <tr>
      <td>TC-02</td>
      <td>环境变量文件丢失后恢复</td>
      <td>✅ PASS</td>
      <td>4</td>
      <td>0</td>
      <td>0</td>
    </tr>
    <tr>
      <td>TC-03</td>
      <td>Cron 配置文件格式错误检测</td>
      <td>✅ PASS</td>
      <td>4</td>
      <td>0</td>
      <td>0</td>
    </tr>
    <tr>
      <td>TC-04</td>
      <td>MySQL 不可达时备份降级</td>
      <td>✅ PASS</td>
      <td>4</td>
      <td>0</td>
      <td>0</td>
    </tr>
    <tr>
      <td>TC-05</td>
      <td>备份文件损坏检测</td>
      <td>❌ FAIL</td>
      <td>2</td>
      <td>1</td>
      <td>0</td>
    </tr>
    <tr>
      <td>TC-06</td>
      <td>COS 未配置时优雅降级</td>
      <td>✅ PASS</td>
      <td>3</td>
      <td>0</td>
      <td>0</td>
    </tr>
    <tr>
      <td>TC-07</td>
      <td>损坏备份文件恢复被拦截</td>
      <td>✅ PASS</td>
      <td>4</td>
      <td>0</td>
      <td>0</td>
    </tr>
    <tr>
      <td>TC-08</td>
      <td>backup-init.sh 批量校验逻辑</td>
      <td>⚠️ WARN</td>
      <td>2</td>
      <td>0</td>
      <td>1</td>
    </tr>
    <tr>
      <td>TC-09</td>
      <td>Cron 任务实际触发验证</td>
      <td>❌ FAIL</td>
      <td>2</td>
      <td>1</td>
      <td>0</td>
    </tr>
    <tr>
      <td>TC-10</td>
      <td>Header + Footer 双校验完整性</td>
      <td>✅ PASS</td>
      <td>5</td>
      <td>0</td>
      <td>0</td>
    </tr>
  </tbody>
</table>

### ⏱️ 耗时数据

<table>
  <thead>
    <tr>
      <th>场景</th>
      <th>测试项</th>
      <th>耗时</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>TC-09</td>
      <td>Cron 任务在 24s 内成功触发</td>
      <td><code>24s</code></td>
    </tr>
  </tbody>
</table>

---
📁 详细报告: [test-report.json]  |  🤖 由 GitHub Actions 自动生成  |  🔄 每次推送自动更新
