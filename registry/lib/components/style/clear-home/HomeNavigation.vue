<template>
  <div class="clear-home-navigation">
    <div class="clear-home-search" role="search" aria-label="B 站搜索">
      <LaunchBar input-label="搜索 B 站" submit-label="搜索" />
    </div>
    <a
      class="clear-home-messages"
      href="https://message.bilibili.com/?spm_id_from=333.1007.0.0#/whisper"
      target="_blank"
      rel="noopener noreferrer"
      :title="messageLabel"
      :aria-label="messageLabel"
      :aria-busy="loading ? 'true' : 'false'"
    >
      <span class="clear-home-message-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m4 7 8 6 8-6" /></svg>
        <span v-if="count !== null && count > 0" class="clear-home-message-count">{{ count > 99 ? '99+' : count }}</span>
        <span v-else-if="error && accountId" class="clear-home-message-unknown">?</span>
      </span>
      <span>消息</span>
    </a>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import { getUID } from '@/core/utils'
import LaunchBar from '@/components/launch-bar/LaunchBar.vue'
import { fetchMessageUnread } from './messages'

const refreshInterval = 60_000
const minimumInterval = 10_000

export default defineComponent({
  components: { LaunchBar },
  props: { active: { type: Boolean, default: true } },
  data() {
    return {
      accountId: getUID() || '',
      count: null as number | null,
      notificationsEnabled: true,
      loading: false,
      error: '',
      disposed: false,
      request: null as AbortController | null,
      refreshTimer: undefined as number | undefined,
      lastRequestAt: 0,
    }
  },
  computed: {
    messageLabel(): string {
      if (!this.accountId) { return '打开消息，登录后查看未读数量' }
      if (this.error) { return '未读数量暂时不可用，点击打开消息' }
      if (this.count === null) { return '打开消息，正在读取未读数量' }
      if (!this.notificationsEnabled) { return '打开消息，账号已关闭消息提醒' }
      return this.count > 0 ? `打开消息，共 ${this.count} 条未读` : '打开消息，暂无未读'
    },
  },
  watch: {
    active() { this.syncActivity() },
  },
  mounted() {
    document.addEventListener('visibilitychange', this.syncActivity)
    window.addEventListener('focus', this.refreshMessages)
    this.syncActivity()
  },
  beforeDestroy() {
    this.disposed = true
    this.pauseRefresh()
    document.removeEventListener('visibilitychange', this.syncActivity)
    window.removeEventListener('focus', this.refreshMessages)
  },
  methods: {
    pauseRefresh() {
      window.clearTimeout(this.refreshTimer)
      this.refreshTimer = undefined
      this.request?.abort()
      this.request = null
      this.loading = false
    },
    scheduleRefresh(delay: number) {
      window.clearTimeout(this.refreshTimer)
      if (this.disposed || !this.active || document.hidden) { return }
      this.refreshTimer = window.setTimeout(this.refreshMessages, delay)
    },
    syncActivity() {
      if (this.disposed || !this.active || document.hidden) { this.pauseRefresh(); return }
      this.refreshMessages()
    },
    async refreshMessages() {
      if (this.disposed || !this.active || document.hidden) { return }
      const uid = getUID() || ''
      if (uid !== this.accountId) {
        this.pauseRefresh()
        this.accountId = uid
        this.count = null
        this.error = ''
        this.notificationsEnabled = true
        this.lastRequestAt = 0
      }
      if (!uid) { this.scheduleRefresh(refreshInterval); return }
      if (this.request) { return }
      const elapsed = Date.now() - this.lastRequestAt
      if (elapsed < minimumInterval) { this.scheduleRefresh(minimumInterval - elapsed); return }
      window.clearTimeout(this.refreshTimer)
      const controller = new AbortController()
      this.request = controller
      this.loading = true
      this.lastRequestAt = Date.now()
      try {
        const snapshot = await fetchMessageUnread(controller.signal)
        if (this.disposed || controller.signal.aborted || this.request !== controller) { return }
        if (snapshot.accountId !== (getUID() || '')) { return }
        this.count = snapshot.count
        this.notificationsEnabled = snapshot.notificationsEnabled
        this.error = ''
      } catch (error) {
        if (this.disposed || controller.signal.aborted || this.request !== controller) { return }
        this.count = null
        this.error = error instanceof Error ? error.message : '未读数量暂时不可用'
      } finally {
        if (this.request === controller) {
          this.request = null
          this.loading = false
          const accountChanged = uid !== (getUID() || '')
          if (accountChanged) { this.count = null }
          this.scheduleRefresh(accountChanged ? 0 : refreshInterval)
        }
      }
    },
  },
})
</script>
