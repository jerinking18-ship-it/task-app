import TaskApp from "@/components/task-app";

export default function Home() {
  return <TaskApp today={new Date().toISOString().slice(0, 10)} />;
}
