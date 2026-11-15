import { permanentRedirect } from "next/navigation";

/** Old address of the Studio. 308 so bookmarks and the installed app keep working. */
export default function MergePage() {
  permanentRedirect("/studio");
}
