import '@fontsource-variable/inter'
import '@mantine/core/styles.css'
import '@mantine/dates/styles.css'
import '@mantine/notifications/styles.css'
import './styles.css'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import 'dayjs/locale/ru'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

dayjs.extend(customParseFormat)
dayjs.locale('ru')

const root = document.getElementById('root')
if (!root) throw new Error('No #root element')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
