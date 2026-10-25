<template>
  <div class="custom-navbar-logo-container">
    <VIcon
      v-if="!seasonLogoUrl"
      icon="logo"
      class="custom-navbar-logo"
      :class="{ theme: useThemeColor }"
    ></VIcon>
    <div
      v-else
      class="custom-navbar-logo season"
      :style="{ backgroundImage: `url(${seasonLogoUrl})` }"
    />
  </div>
</template>

<script lang="ts">
import { getComponentSettings } from '@/core/settings'
import {
  addNavbarListener,
  getNavbarSession,
  isNavbarActive,
  isNavbarSessionActive,
} from '../lifecycle'
import { getJson } from '@/core/ajax'
import { VIcon } from '@/ui'

export default Vue.extend({
  name: 'NavbarLogo',
  components: {
    VIcon,
  },
  data() {
    return {
      seasonLogoUrl: '',
      useThemeColor: true,
    }
  },
  watch: {
    seasonLogoUrl() {
      document.body.classList.toggle(
        'season-logo-enabled',
        isNavbarActive() && Boolean(this.seasonLogoUrl),
      )
    },
  },
  async created() {
    addNavbarListener(
      'customNavbar.seasonLogo',
      async (value: boolean) => {
        if (!value) {
          this.seasonLogoUrl = ''
          return
        }
        const session = getNavbarSession()
        try {
          const json = await getJson('https://api.bilibili.com/x/web-show/page/header?resource_id=1')
          if (
            !isNavbarSessionActive(session) ||
            !getComponentSettings('customNavbar').options.seasonLogo
          ) {
            return
          }
          this.seasonLogoUrl =
            json.code === 0
              ? lodash.get(json, 'data.litpic', '').replace('http:', 'https:')
              : ''
          document.body.classList.toggle('season-logo-enabled', Boolean(this.seasonLogoUrl))
        } catch {
          if (isNavbarSessionActive(session)) {
            this.seasonLogoUrl = ''
          }
        }
      },
      true,
    )
    addNavbarListener(
      'customNavbar.themeLogo',
      async (value: boolean) => {
        this.useThemeColor = value
      },
      true,
    )
  },
})
</script>

<style lang="scss">
@import 'common';

.custom-navbar-logo-container {
  @include v-stretch();
  justify-content: center;
  height: 100%;
  padding: 8px 0;
  box-sizing: border-box;
  max-height: 54px;
  width: calc(var(--navbar-height) * 1.3);
}
.custom-navbar-logo {
  .custom-navbar:not(.fill) &:not(.season) {
    body.dark & {
      color: #fff;
    }
    &.theme {
      color: var(--theme-color);
      body.dark & {
        color: var(--theme-color);
      }
    }
  }
  &.be-icon {
    --size: calc(var(--navbar-height) / 2) !important;
    width: 100%;
    max-height: 32px;
  }
  &.season {
    height: 0;
    flex: 1 0 0;
    background-size: contain;
    background-position: center;
    background-repeat: no-repeat;
    filter: drop-shadow(0 0 2px #0002);
  }
}
body.season-logo-enabled {
  .bili-header .inner-logo {
    display: none !important;
  }
}
</style>
