<script setup>
import { END_LABEL, END_STAGES, STATUSES, emptyRecord } from '../lib/progress.js'
import { linkParts } from '../lib/catalog.js'

defineProps({
  companies: { type: Array, required: true },
  categories: { type: Object, required: true },
  progress: { type: Object, required: true },
  offset: { type: Number, default: 0 },
})
const emit = defineEmits(['stage', 'date', 'end-stage'])

function changeStage(event, company, previous) {
  if (!event.target.value && !window.confirm(`确定清空「${company}」的投递进度和日期记录吗？`)) {
    event.target.value = previous
    return
  }
  emit('stage', company, event.target.value)
}
</script>

<template>
  <div class="table-wrap" tabindex="0" role="region" aria-label="秋招信息表格，可横向滚动">
    <table aria-label="2027届秋招公司信息与投递进度">
      <thead>
        <tr>
          <th scope="col">序号</th>
          <th scope="col">开启时间</th>
          <th scope="col">公司</th>
          <th scope="col">企业性质 / 届别</th>
          <th scope="col">分类</th>
          <th scope="col">岗位方向 / 说明</th>
          <th scope="col">投递入口 / 信息来源</th>
          <th scope="col">我的投递进度</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="!companies.length"><td colspan="8" class="empty">没有符合条件的公司，试试调整筛选条件。</td></tr>
        <tr v-for="(company, index) in companies" :key="company.company">
          <td class="row-number">{{ offset + index + 1 }}</td>
          <td class="date-cell">{{ company.date || '待确认' }}</td>
          <th scope="row" class="company-cell">{{ company.company }}</th>
          <td><div class="badges"><span class="pill">{{ company.ent || '民企' }}</span><span class="pill neutral">{{ company.cohort || '2027届' }}</span></div></td>
          <td><span class="pill category">{{ categories[company.company] || company.cat || '未分类' }}</span></td>
          <td class="roles-cell">
            <div>{{ company.roles || '岗位信息待补充' }}</div>
            <details v-if="company.note"><summary>招聘说明</summary><p>{{ company.note }}</p></details>
          </td>
          <td class="links-cell">
            <template v-if="company.portal">
              <template v-for="(part, partIndex) in linkParts(company.portal)" :key="partIndex">
                <a v-if="part.href" :href="part.href" target="_blank" rel="noopener noreferrer">{{ part.text }}</a>
                <span v-else>{{ part.text }}</span>
              </template>
            </template>
            <span v-else class="muted">官方投递入口待补充</span>
            <details v-if="company.source">
              <summary>信息来源</summary>
              <template v-for="(part, partIndex) in linkParts(company.source)" :key="partIndex">
                <a v-if="part.href" :href="part.href" target="_blank" rel="noopener noreferrer">{{ part.text }}</a>
                <span v-else>{{ part.text }}</span>
              </template>
            </details>
          </td>
          <td class="progress-cell">
            <select
              :value="progress[company.company]?.stage || ''"
              :class="['stage-select', { filled: progress[company.company]?.stage }]"
              :aria-label="`${company.company} 投递进度`"
              @change="changeStage($event, company.company, progress[company.company]?.stage || '')"
            >
              <option value="">未填写</option>
              <option v-for="stage in STATUSES" :key="stage" :value="stage">{{ stage }}</option>
            </select>
            <div class="timeline">
              <template v-for="stage in STATUSES" :key="stage">
                <button
                  v-if="progress[company.company]?.dates[stage]"
                  type="button"
                  :title="`点击把${stage}日期更新为今天`"
                  @click="emit('date', company.company, stage)"
                >{{ stage }} {{ progress[company.company].dates[stage] }}</button>
              </template>
              <span v-if="!Object.keys((progress[company.company] || emptyRecord()).dates).length" class="muted">尚未记录</span>
            </div>
            <label v-if="progress[company.company]?.stage === '流程结束'" class="end-stage-label">
              结束阶段
              <select :value="progress[company.company]?.endStage || ''" :aria-label="`${company.company} 流程结束阶段`" @change="emit('end-stage', company.company, $event.target.value)">
                <option value="">未标注</option>
                <option v-for="stage in END_STAGES" :key="stage" :value="stage">{{ END_LABEL[stage] }}</option>
              </select>
            </label>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
