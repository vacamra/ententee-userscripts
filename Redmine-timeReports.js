// ==UserScript==
// @name        ententee redmine time reporting
// @namespace   Violentmonkey Scripts
// @match       https://redmine.ententee.com/projects/*/time_entries/new
// @grant       none
// @version     1.0
// @author      -
// @description 8/30/2023, 12:26:12 PM
// ==/UserScript==

const projectName = window.location.pathname.match(/projects\/([^\/]*)/)[1]
const content = document.getElementById("content");
const form = document.getElementById("new_time_entry");

const inputTextBox = document.createElement("textarea")
inputTextBox.rows = 5
const btn = document.createElement("input")
btn.type = "button"
btn.value = "Import"
btn.addEventListener("click", importData)
content.insertBefore(btn, form)
content.insertBefore(inputTextBox, btn)

const reportDiv = document.createElement("div")
content.insertBefore(reportDiv, form)

let reports = []
let apiKey = null;

async function ensureApiKeyFetched() {
  if (apiKey != null) return;
  const apiKeyResponse = await fetch("https://redmine.ententee.com/my/api_key")
  apiKey = (await apiKeyResponse.text()).match(/<pre>(.*)<\/pre>/)[1]
}

async function fetchExistingReports(from, to) {
  await ensureApiKeyFetched()
  const userId = document.getElementsByClassName("user active")[0].href.split("/")[4]
  const response = await fetch(`https://redmine.ententee.com/time_entries.json?from=${from}&to=${to}&project_id=${projectName}&user_id=${userId}`, {
    headers: {
      "X-Redmine-API-Key": apiKey
    }
  })
  return await response.json()
}


async function importData() {
  const rawData = inputTextBox.value;
  const table = rawData.split("\n").map(line => line.split("\t"))
  const days = table[0].slice(4, 11).map(date => {
    const parts = date.split("/") // convert from DD-MM-YYYY
    if (parts[0].length == 1) {
      parts[0] = `0${parts[0]}`
    }
    if (parts[1].length == 1) {
      parts[1] = `0${parts[1]}`
    }
    return `${parts[2]}-${parts[1]}-${parts[0]}` // to ISO
  })

  const taskRows = table.slice(2)

  const tasks = taskRows.filter(row => row[0] !== "")
    .flatMap(row =>
    row
      .slice(4, 11)
      .map((hour, index) => ({
        category: row[0],
        task: row[1] === "" ? null : parseInt(row[1]),
        description: row[2],
        time: hour === "" ? 0 : parseFloat(hour),
        day: days[index]
      }))
      .filter(obj => obj.time !== 0)
  )
  reports = tasks
  renderReports(days)
  inputTextBox.value = ""
}


function renderReports(days) {
  reportDiv.textContent = ''

  const reportsByDay = []
  for(const day of days) {
    reportsByDay.push(reports.filter(report => report.day == day))
  }

  let divContent = `
    <div style="display:  flex; justify-content: space-between; flex-wrap: wrap;">
      ${reportsByDay.map((dayReports, index) => `
        <div style="padding: 0.5em; margin: 0.5em; background-color: #d6d6d6;">
          <span>${days[index]}</span>
          ${dayReports.map(report => `
            <div class="box">
              <span>Task: ${report.task ?? "N/A"}</span><br />
              <span>Time: ${report.time}h</span><br />
              <span>Note: ${report.description}</span><br />
              <span>Category: ${report.category}</span><br />
            </div>
          `).join("")}
        </div>
      `).join("")}
    </div>
  `

  divContent += '<input id="push-reports" type="button" value="Create"/>'

  reportDiv.innerHTML = divContent
  document.getElementById("push-reports").addEventListener("click", pushReports)
}

async function getProjectId() {
  await ensureApiKeyFetched()
  const allProjects = await (await fetch("https://redmine.ententee.com/projects.json", {
    method: 'GET',
    headers: {
      "X-Redmine-API-Key": apiKey
    }
  })).json()

  return allProjects.projects.find(proj => proj.identifier === projectName).id
}

function getActivityIdMap() {
  const options = document.getElementById("time_entry_activity_id")
    .getElementsByTagName("option")

  const result = {}
  for (const option of options) {
    result[option.textContent] = option.value
  }
  return result
}

async function pushReports(sender, e) {
  sender.enabled = false
  await ensureApiKeyFetched()
  const projectId = await getProjectId(apiKey)
  const activityIds = getActivityIdMap()

  for (const report of reports) {
    await fetch("https://redmine.ententee.com/time_entries.json", {
      method: 'POST',
      headers: {
        "Content-Type": "application/json",
        "X-Redmine-API-Key": apiKey
      },
      body: JSON.stringify({
        time_entry: {
          issue_id: report.task,
          project_id: report.task == null ? projectId : undefined,
          spent_on: report.day,
          hours: report.time,
          comments: report.description.substr(0, 1024), //max comment length
          activity_id: activityIds[report.category]
        }
      })
    })
  }
  sender.enabled = true
}