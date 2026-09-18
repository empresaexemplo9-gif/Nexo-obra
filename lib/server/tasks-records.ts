export type TaskRow = {
  id: string;
  project_id: string;
  project_name: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  assignee_member_id: string | null;
  assignee_name: string | null;
  parent_task_id: string | null;
  starts_at: string | null;
  due_at: string | null;
  estimated_minutes: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export const taskSelect = `SELECT
  t.id, t.project_id, p.name AS project_name, t.title, t.description,
  t.status, t.priority, t.assignee_member_id, m.name AS assignee_name,
  t.parent_task_id, t.starts_at, t.due_at, t.estimated_minutes,
  t.completed_at, t.created_at, t.updated_at
  FROM tasks t
  INNER JOIN projects p ON p.id = t.project_id AND p.organization_id = t.organization_id
  LEFT JOIN members m ON m.id = t.assignee_member_id AND m.organization_id = t.organization_id`;

export function taskResponse(row: TaskRow) {
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    assigneeMemberId: row.assignee_member_id,
    assigneeName: row.assignee_name,
    parentTaskId: row.parent_task_id,
    startsAt: row.starts_at,
    dueAt: row.due_at,
    estimatedMinutes: row.estimated_minutes,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
