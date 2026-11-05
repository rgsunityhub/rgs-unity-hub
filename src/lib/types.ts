export type Role = "owner" | "admin" | "user";
export type Page = "home" | "dashboard" | "storage" | "youtube" | "chat" | "members" | "profile" | "invites" | "notifications" | "settings";

export interface Profile {
  id: string;
  nickname: string;
  avatar_url: string | null;
  bio: string;
  role: Role;
  created_at: string;
}

export interface Publication {
  id: string;
  owner_id: string;
  kind: "text" | "file" | "youtube";
  title: string;
  body: string;
  visibility: "public" | "private";
  created_at: string;
  profiles?: Pick<Profile, "nickname" | "avatar_url" | "role"> | null;
}
