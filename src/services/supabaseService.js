import { supabase } from "./supabaseClient.js";

const getUserId = async () => {
  const { data, error } = await supabase.auth.getUser();

  if (error) {
    throw error;
  }

  if (!data?.user?.id) {
    throw new Error("No authenticated user found.");
  }

  return data.user.id;
};

export async function testSupabaseConnection() {
  const { data, error } = await supabase
    .from("collections")
    .select("id")
    .limit(1);

  if (error) {
    throw error;
  }

  return data;
}

export async function getCollections() {
  const userId = await getUserId();

  const { data, error } = await supabase
    .from("collections")
    .select("*")
    .eq("user_id", userId)
    .order("collection_date", { ascending: false });

  if (error) throw error;

  return data || [];
}

export async function createCollection(collection) {
  const userId = await getUserId();

  const payload = {
    user_id: userId,
    name: collection.name,
    description: collection.description || null,
    collection_date: collection.collectionDate || collection.collection_date || null
  };

  const { data, error } = await supabase
    .from("collections")
    .insert(payload)
    .select()
    .single();

  if (error) throw error;

  return data;
}